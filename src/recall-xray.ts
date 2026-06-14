import { readEvidenceRecords } from "./evidence";
import { inferMemoryKind } from "./memory-kind";
import { runMemoryProcessorPipeline } from "./processors";
import { extractHardRules } from "./rules";
import { redactSecrets } from "./secret-scanner";
import { loadAllRecords } from "./store";
import { isTombstonedRecord } from "./tombstones";
import type { EvidenceRecord, EvidenceSourceKind, MemoryKind, MemoryRecord, SessionContext } from "./types";

export interface RecallXrayOptions {
  query: string;
  profile_id?: string;
  resource_id?: string;
  thread_id?: string;
  project_root?: string;
  repository_id?: string;
  working_directory?: string;
  recent_files_touched?: string[];
  maxRecords?: number;
  governance_mode?: "compatibility" | "strict";
}

export interface IncludedMemoryXray {
  memory_id: string;
  layer?: "L1" | "L2" | "L3";
  profile_id?: string;
  resource_id?: string;
  thread_id?: string;
  memory_kind?: MemoryKind;
  retrieval_tier: "hard_rule" | "policy_rule" | "scoped_memory" | "term_match" | "evidence_dependency" | "session_context" | "fallback";
  retrieval_score?: number;
  included_reason: string;
  trust_class?: string;
  verification_status?: string;
  evidence_ids?: string[];
  evidence_source_kinds?: EvidenceSourceKind[];
  evidence_status?: string;
  contested?: boolean;
  stale?: boolean;
  tombstoned?: boolean;
  dependency_invalidated?: boolean;
  applies_when?: string[];
  does_not_apply_when?: string[];
  known_exceptions?: string[];
  statement_excerpt?: string;
  hard_rule?: boolean;
  rule_type?: string;
  hard_rule_reason?: string;
  governance_safe?: boolean;
  warnings?: string[];
}

export interface ExcludedMemoryXray {
  memory_id: string;
  excluded_reason: string;
  filtered_by: string[];
  scope_mismatch?: boolean;
  negative_scope_match?: boolean;
  tombstoned?: boolean;
  deleted?: boolean;
  superseded?: boolean;
  contested?: boolean;
  dependency_invalidated?: boolean;
}

export interface RecallXraySummary {
  query: string;
  included_count: number;
  excluded_count: number;
  hard_rule_count: number;
  contested_count: number;
  stale_count: number;
  dependency_invalidated_count: number;
  tombstoned_count: number;
}

export interface RecallXrayReport {
  summary: RecallXraySummary;
  included: IncludedMemoryXray[];
  excluded: ExcludedMemoryXray[];
}

function terms(query: string): Set<string> {
  return new Set(query.toLowerCase().split(/[^a-z0-9-]+/).filter((t) => t.length > 2));
}
function relevance(record: MemoryRecord, queryTerms: Set<string>): number {
  if (record.layer === "L1") return 1;
  const haystack = `${record.statement} ${record.tags.join(" ")} ${record.ruleType ?? ""}`.toLowerCase();
  const hits = [...queryTerms].filter((t) => haystack.includes(t)).length;
  return queryTerms.size ? hits / queryTerms.size : 0;
}
function stale(record: MemoryRecord): boolean {
  const ts = Date.parse(record.updated_at);
  return Number.isFinite(ts) ? Date.now() - ts > 90 * 86_400_000 : false;
}
function evidenceIds(record: MemoryRecord): string[] { return [...new Set(record.evidence.map((e) => e.ref))]; }
function evidenceFor(record: MemoryRecord, evidence: EvidenceRecord[]): EvidenceRecord[] {
  const ids = new Set(evidenceIds(record));
  return evidence.filter((e) => ids.has(e.id) || e.related_memory_ids.includes(record.id));
}
function dependencyInvalidated(evidence: EvidenceRecord[]): boolean {
  return evidence.some((e) => e.redaction_status === "deleted" || e.redaction_status === "redacted");
}
function contextFrom(options: RecallXrayOptions): SessionContext {
  return {
    resource_id: options.resource_id ?? "default",
    profile_id: options.profile_id ?? "default",
    thread_id: options.thread_id,
    project_root: options.project_root,
    repository_id: options.repository_id,
    working_directory: options.working_directory,
    latest_user_message: options.query,
    first_user_message: options.query,
    recent_files_touched: options.recent_files_touched,
    detected_domain_tags: [],
    task_intent: options.query,
    is_trivial_prompt: false,
  };
}

export function buildRecallXray(root: string, options: RecallXrayOptions): RecallXrayReport {
  const all = loadAllRecords(root);
  const evidence = readEvidenceRecords(root);
  const q = terms(options.query);
  const pipeline = runMemoryProcessorPipeline(all, contextFrom(options));
  const hardRuleIds = new Set(extractHardRules(pipeline.records).map((record) => record.id));
  const surviving = new Set(pipeline.records.map((r) => r.id));
  const exclusionById = new Map<string, { reasons: string[]; processors: string[] }>();
  for (const trace of pipeline.traces) {
    for (const [id, reason] of Object.entries(trace.exclusion_reasons)) {
      const entry = exclusionById.get(id) ?? { reasons: [], processors: [] };
      entry.reasons.push(reason); entry.processors.push(trace.processor);
      exclusionById.set(id, entry);
    }
  }

  const included: IncludedMemoryXray[] = [];
  const excluded: ExcludedMemoryXray[] = [];
  for (const record of all) {
    const evs = evidenceFor(record, evidence);
    const invalidated = dependencyInvalidated(evs);
    const tombstoned = isTombstonedRecord(root, record.id);
    const score = relevance(record, q);
    const isHardRuleCandidate = Boolean(record.ruleType && ["avoid_pattern", "prefer_pattern", "convention", "correction"].includes(record.ruleType) && record.confidence >= 0.85);
    const evsPresent = evs.length > 0;
    const strictSafe = options.governance_mode === "strict" ? evsPresent && !invalidated : true;
    const hardRule = hardRuleIds.has(record.id) && strictSafe;
    const notRelevant = !surviving.has(record.id) ? false : score <= 0 && record.layer !== "L1" && !hardRule;
    if (surviving.has(record.id) && !tombstoned && !invalidated && !notRelevant && (included.length < (options.maxRecords ?? 20))) {
      included.push({
        memory_id: record.id,
        layer: record.layer,
        profile_id: record.profile_id,
        resource_id: record.resource_id,
        thread_id: record.thread_id,
        memory_kind: record.memory_kind ?? inferMemoryKind(record),
        retrieval_tier: hardRule ? "hard_rule" : record.layer === "L1" ? "policy_rule" : score > 0 ? "term_match" : "scoped_memory",
        retrieval_score: Number(score.toFixed(3)),
        included_reason: hardRule ? "Active high-confidence typed correction/convention selected as hard rule after policy filters" : record.layer === "L1" ? "L1 records are included after policy filters" : "Matched query terms after policy filters",
        trust_class: evs[0]?.trust_class,
        verification_status: (record as any).verification_status,
        evidence_ids: evidenceIds(record),
        evidence_source_kinds: [...new Set(evs.map((e) => e.source_kind))],
        evidence_status: evs.length === 0 ? "missing" : invalidated ? "invalidated" : "present",
        contested: record.status === "contested",
        stale: stale(record),
        tombstoned,
        dependency_invalidated: invalidated,
        applies_when: record.applies_when,
        does_not_apply_when: record.does_not_apply_when,
        known_exceptions: record.known_exceptions,
        statement_excerpt: redactSecrets(record.statement.slice(0, 240)),
        hard_rule: hardRule,
        rule_type: record.ruleType,
        hard_rule_reason: hardRule ? "active high-confidence hard-rule ruleType with policy filters satisfied" : isHardRuleCandidate ? "typed high-confidence candidate not attributed as clean hard rule under current governance" : undefined,
        governance_safe: isHardRuleCandidate ? strictSafe : undefined,
        warnings: isHardRuleCandidate && !strictSafe ? ["strict governance requires structured live evidence before hard-rule attribution"] : undefined,
      });
    } else {
      const ex = exclusionById.get(record.id);
      const reasons = [...(ex?.reasons ?? [])];
      if (tombstoned) reasons.push("tombstoned");
      if (invalidated) reasons.push("dependency_invalidated");
      if (notRelevant) reasons.push("not_relevant_to_query");
      excluded.push({
        memory_id: record.id,
        excluded_reason: reasons[0] ?? "not_selected",
        filtered_by: ex?.processors ?? (reasons.length ? ["RecallXrayPolicy"] : ["RetrievalLimit"]),
        scope_mismatch: reasons.some((r) => r.includes("profile_mismatch") || r.includes("project_scope_mismatch")),
        negative_scope_match: reasons.some((r) => r.includes("does_not_apply_when") || r.includes("known_exceptions")),
        tombstoned,
        deleted: record.status === "deleted",
        superseded: record.status === "superseded",
        contested: record.status === "contested",
        dependency_invalidated: invalidated,
      });
    }
  }

  return {
    summary: {
      query: options.query,
      included_count: included.length,
      excluded_count: excluded.length,
      hard_rule_count: included.filter((m) => m.retrieval_tier === "hard_rule").length,
      contested_count: [...included, ...excluded].filter((m) => m.contested).length,
      stale_count: included.filter((m) => m.stale).length,
      dependency_invalidated_count: [...included, ...excluded].filter((m) => m.dependency_invalidated).length,
      tombstoned_count: [...included, ...excluded].filter((m) => m.tombstoned).length,
    },
    included,
    excluded,
  };
}

export function renderRecallXrayReport(report: RecallXrayReport): string {
  const lines = [
    `PI Recall X-ray — ${report.summary.query}`,
    `Included: ${report.summary.included_count}  Excluded: ${report.summary.excluded_count}  Contested: ${report.summary.contested_count}  Stale: ${report.summary.stale_count}  Dependency-invalidated: ${report.summary.dependency_invalidated_count}  Tombstoned: ${report.summary.tombstoned_count}`,
    "",
    "## Included",
  ];
  for (const item of report.included) lines.push(`- ${item.memory_id} [${item.layer ?? "?"}${item.memory_kind ? `, ${item.memory_kind}` : ""}${item.hard_rule ? ", hard_rule" : ""}] tier=${item.retrieval_tier} score=${item.retrieval_score ?? "n/a"} evidence=${item.evidence_status ?? "unknown"} sources=${(item.evidence_source_kinds ?? []).join(",") || "unknown"}: ${item.included_reason}${item.warnings?.length ? ` warnings=${item.warnings.join(";")}` : ""}${item.statement_excerpt ? ` — ${item.statement_excerpt}` : ""}`);
  lines.push("", "## Excluded");
  for (const item of report.excluded) lines.push(`- ${item.memory_id}: ${item.excluded_reason} (${item.filtered_by.join(", ")})`);
  return redactSecrets(lines.join("\n"));
}
