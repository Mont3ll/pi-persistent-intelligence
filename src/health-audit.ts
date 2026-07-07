import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { readEvidenceRecords } from "./evidence";
import { listCandidates } from "./inbox";
import { ensureMemoryDirs } from "./paths";
import { readRecentRuntimeEvents } from "./runtime-events";
import { redactSecrets, redactSecretsInObject } from "./secret-scanner";
import { loadAllRecords } from "./store";
import type { CaptureCandidate, MemoryRecord } from "./types";

export type HealthCategoryId = "integrity" | "governance" | "memory_quality" | "inbox" | "runtime";
export type HealthSeverity = "info" | "warning" | "error";

export interface HealthAuditFinding {
  code: string;
  category: HealthCategoryId;
  severity: HealthSeverity;
  reason: string;
  affected_ids: string[];
  evidence_ids: string[];
  mutation_performed: false;
}

export interface HealthAuditRecommendation {
  id: string;
  category: HealthCategoryId;
  summary: string;
  reason: string;
  affected_ids: string[];
  review_required: true;
  mutation_performed: false;
}

export interface HealthCategoryScore {
  id: HealthCategoryId;
  label: string;
  score: number;
  findings: number;
  errors: number;
  warnings: number;
}

export interface HealthAuditSnapshot {
  timestamp: string;
  active_memories: number;
  candidate_count: number;
  duplicates: number;
  conflicts: number;
  warnings: number;
  errors: number;
  governance_score: number;
  overall_score: number;
  runtime_warnings: number;
}

export interface HealthAuditTrend {
  previous_timestamp: string;
  overall_delta: number;
  duplicates_delta: number;
  conflicts_delta: number;
  inbox_delta: number;
  runtime_warnings_delta: number;
}

export interface MemoryHealthAuditReport {
  generated_at: string;
  root: string;
  health_score: { overall: number; explanation: string };
  categories: HealthCategoryScore[];
  findings: HealthAuditFinding[];
  recommendations: HealthAuditRecommendation[];
  snapshot: HealthAuditSnapshot;
  trend?: HealthAuditTrend;
  mutation_performed: false;
}

export interface MemoryHealthAuditContext {
  root: string;
  now: string;
  records: MemoryRecord[];
  candidates: CaptureCandidate[];
  evidence: ReturnType<typeof readEvidenceRecords>;
}

export interface MemoryHealthAuditModule {
  id: HealthCategoryId;
  label: string;
  run(ctx: MemoryHealthAuditContext): HealthAuditFinding[];
}

export interface RunMemoryHealthAuditOptions { now?: string; }

function finding(input: Omit<HealthAuditFinding, "mutation_performed">): HealthAuditFinding {
  return { ...input, mutation_performed: false };
}

function recommendation(finding: HealthAuditFinding): HealthAuditRecommendation {
  const label = finding.code.replace(/_/g, " ");
  return {
    id: `rec_${finding.code}_${finding.affected_ids[0] ?? "all"}`.slice(0, 120),
    category: finding.category,
    summary: `Review ${label}`,
    reason: finding.reason,
    affected_ids: finding.affected_ids,
    review_required: true,
    mutation_performed: false,
  };
}

function daysBetween(a: string, b: string): number {
  const diff = new Date(b).getTime() - new Date(a).getTime();
  return Number.isFinite(diff) ? diff / 86_400_000 : 0;
}

const integrityModule: MemoryHealthAuditModule = {
  id: "integrity",
  label: "Integrity",
  run(ctx) {
    const ids = new Set(ctx.records.map((record) => record.id));
    const orphan = ctx.evidence.filter((ev) => ev.related_memory_ids.length > 0 && ev.related_memory_ids.every((id) => !ids.has(id)) && ev.redaction_status !== "deleted");
    return orphan.length ? [finding({ code: "orphan_evidence", category: "integrity", severity: "warning", reason: `${orphan.length} evidence record(s) reference missing memories.`, affected_ids: orphan.map((ev) => ev.id), evidence_ids: orphan.map((ev) => ev.id) })] : [];
  },
};

const governanceModule: MemoryHealthAuditModule = {
  id: "governance",
  label: "Governance",
  run(ctx) {
    const activeWithoutEvidence = ctx.records.filter((record) => record.status === "active" && record.evidence.length === 0);
    const deletedActive = ctx.records.filter((record) => record.status === "deleted" && record.superseded_by.length > 0);
    const findings: HealthAuditFinding[] = [];
    if (activeWithoutEvidence.length) findings.push(finding({ code: "active_memory_missing_evidence", category: "governance", severity: "error", reason: `${activeWithoutEvidence.length} active memory record(s) lack supporting evidence.`, affected_ids: activeWithoutEvidence.map((r) => r.id), evidence_ids: [] }));
    if (deletedActive.length) findings.push(finding({ code: "deleted_memory_has_supersession_reference", category: "governance", severity: "warning", reason: `${deletedActive.length} deleted memory record(s) still carry supersession references for review.`, affected_ids: deletedActive.map((r) => r.id), evidence_ids: [] }));
    return findings;
  },
};

const qualityModule: MemoryHealthAuditModule = {
  id: "memory_quality",
  label: "Memory Quality",
  run(ctx) {
    const findings: HealthAuditFinding[] = [];
    const keyMap = new Map<string, string[]>();
    for (const record of ctx.records.filter((r) => r.status === "active")) {
      const key = String((record as unknown as { normalized_key?: string }).normalized_key ?? "");
      if (!key) continue;
      const scoped = `${record.profile_id ?? "legacy"}|${key}`;
      keyMap.set(scoped, [...(keyMap.get(scoped) ?? []), record.id]);
    }
    const duplicateIds = [...keyMap.values()].filter((ids) => ids.length > 1).flat();
    if (duplicateIds.length) findings.push(finding({ code: "duplicate_normalized_key", category: "memory_quality", severity: "warning", reason: `${duplicateIds.length} active memory records share normalized keys; review for duplicate or supersede handling.`, affected_ids: duplicateIds, evidence_ids: [] }));
    const lowConfidence = ctx.records.filter((record) => record.status === "active" && record.confidence < 0.65);
    if (lowConfidence.length) findings.push(finding({ code: "low_confidence_active_memory", category: "memory_quality", severity: "warning", reason: `${lowConfidence.length} active memory record(s) have confidence below 0.65.`, affected_ids: lowConfidence.map((r) => r.id), evidence_ids: lowConfidence.flatMap((r) => r.evidence.map((ev) => ev.ref)) }));
    const conflicts = ctx.records.filter((record) => record.status === "contested");
    if (conflicts.length) findings.push(finding({ code: "contested_memory_active_review", category: "memory_quality", severity: "warning", reason: `${conflicts.length} contested memory record(s) remain unresolved.`, affected_ids: conflicts.map((r) => r.id), evidence_ids: [] }));
    return findings;
  },
};

const inboxModule: MemoryHealthAuditModule = {
  id: "inbox",
  label: "Inbox",
  run(ctx) {
    const stale = ctx.candidates.filter((candidate) => candidate.status === "new" && daysBetween(candidate.created_at, ctx.now) > 14);
    return stale.length ? [finding({ code: "stale_inbox_candidate", category: "inbox", severity: "warning", reason: `${stale.length} new inbox candidate(s) are older than 14 days and may need review or cleanup.`, affected_ids: stale.map((c) => c.id), evidence_ids: stale.flatMap((c) => c.evidence_ids ?? []) })] : [];
  },
};

const runtimeModule: MemoryHealthAuditModule = {
  id: "runtime",
  label: "Runtime",
  run(ctx) {
    const warnings = readRecentRuntimeEvents(ctx.root, { hours: 48, minSeverity: "medium" }).filter((event) => event.type === "warn" || event.type === "error");
    return warnings.length ? [finding({ code: "recent_runtime_warnings", category: "runtime", severity: warnings.some((event) => event.type === "error") ? "error" : "warning", reason: `${warnings.length} medium/high runtime warning or error event(s) occurred in the last 48 hours.`, affected_ids: warnings.map((event) => `${event.component}:${event.timestamp}`), evidence_ids: [] })] : [];
  },
};

export const DEFAULT_HEALTH_AUDIT_MODULES: MemoryHealthAuditModule[] = [integrityModule, governanceModule, qualityModule, inboxModule, runtimeModule];

function categoryScore(module: MemoryHealthAuditModule, findings: HealthAuditFinding[]): HealthCategoryScore {
  const own = findings.filter((f) => f.category === module.id);
  const errors = own.filter((f) => f.severity === "error").length;
  const warnings = own.filter((f) => f.severity === "warning").length;
  return { id: module.id, label: module.label, score: Math.max(0, 100 - errors * 25 - warnings * 10), findings: own.length, errors, warnings };
}

function snapshotPath(root: string): string {
  const dir = join(ensureMemoryDirs(root).reports, "health-audit");
  mkdirSync(dir, { recursive: true });
  return join(dir, "snapshots.jsonl");
}

function reportPath(root: string, timestamp: string, ext: "json" | "md"): string {
  const dir = join(ensureMemoryDirs(root).reports, "health-audit");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${timestamp.replace(/[:.]/g, "-").slice(0, 19)}.${ext}`);
}

export function readHealthAuditSnapshots(root: string): HealthAuditSnapshot[] {
  const file = snapshotPath(root);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as HealthAuditSnapshot]; } catch { return []; }
  });
}

function trendFor(root: string, current: HealthAuditSnapshot): HealthAuditTrend | undefined {
  const previous = readHealthAuditSnapshots(root).at(-1);
  if (!previous) return undefined;
  return {
    previous_timestamp: previous.timestamp,
    overall_delta: current.overall_score - previous.overall_score,
    duplicates_delta: current.duplicates - previous.duplicates,
    conflicts_delta: current.conflicts - previous.conflicts,
    inbox_delta: current.candidate_count - previous.candidate_count,
    runtime_warnings_delta: current.runtime_warnings - previous.runtime_warnings,
  };
}

export function runMemoryHealthAudit(root: string, options: RunMemoryHealthAuditOptions = {}): MemoryHealthAuditReport {
  const now = options.now ?? new Date().toISOString();
  ensureMemoryDirs(root);
  const records = loadAllRecords(root);
  const candidates = listCandidates(root);
  const evidence = readEvidenceRecords(root);
  const ctx: MemoryHealthAuditContext = { root, now, records, candidates, evidence };
  const findings = DEFAULT_HEALTH_AUDIT_MODULES.flatMap((module) => module.run(ctx));
  const categories = DEFAULT_HEALTH_AUDIT_MODULES.map((module) => categoryScore(module, findings));
  const overall = Math.round(categories.reduce((sum, category) => sum + category.score, 0) / Math.max(1, categories.length));
  const duplicates = findings.filter((f) => f.code === "duplicate_normalized_key").reduce((sum, f) => sum + f.affected_ids.length, 0);
  const conflicts = records.filter((record) => record.status === "contested").length;
  const runtimeWarnings = findings.filter((f) => f.code === "recent_runtime_warnings").reduce((sum, f) => sum + f.affected_ids.length, 0);
  const snapshot: HealthAuditSnapshot = {
    timestamp: now,
    active_memories: records.filter((record) => record.status === "active").length,
    candidate_count: candidates.filter((candidate) => candidate.status === "new").length,
    duplicates,
    conflicts,
    warnings: findings.filter((f) => f.severity === "warning").length,
    errors: findings.filter((f) => f.severity === "error").length,
    governance_score: categories.find((category) => category.id === "governance")?.score ?? 100,
    overall_score: overall,
    runtime_warnings: runtimeWarnings,
  };
  return {
    generated_at: now,
    root,
    health_score: { overall, explanation: `Average of ${categories.length} category scores; errors subtract 25 and warnings subtract 10 within each category.` },
    categories,
    findings,
    recommendations: findings.filter((f) => f.severity !== "info").map(recommendation),
    snapshot,
    trend: trendFor(root, snapshot),
    mutation_performed: false,
  };
}

export function renderHealthAuditReport(report: MemoryHealthAuditReport): string {
  const trend = report.trend ? `\nTrend vs ${report.trend.previous_timestamp}: overall ${report.trend.overall_delta >= 0 ? "+" : ""}${report.trend.overall_delta}, duplicates ${report.trend.duplicates_delta >= 0 ? "+" : ""}${report.trend.duplicates_delta}, inbox ${report.trend.inbox_delta >= 0 ? "+" : ""}${report.trend.inbox_delta}.` : "\nTrend: first snapshot.";
  return redactSecrets([
    "# PI Memory Health Audit",
    "",
    `Generated: ${report.generated_at}`,
    `Health: ${report.health_score.overall} / 100`,
    report.health_score.explanation,
    trend,
    "",
    "## Category Breakdown",
    ...report.categories.map((category) => `- ${category.label}: ${category.score}/100 (${category.errors} errors, ${category.warnings} warnings)`),
    "",
    "## Findings",
    ...(report.findings.length ? report.findings.map((finding) => `- [${finding.severity}] ${finding.code}: ${finding.reason} Affected: ${finding.affected_ids.join(", ") || "none"}. No automatic mutation performed.`) : ["- No findings requiring attention. No automatic mutation performed."]),
    "",
    "## Recommendations",
    ...(report.recommendations.length ? report.recommendations.map((rec) => `- ${rec.summary}: ${rec.reason} Review required; no automatic mutation performed.`) : ["- No review recommendations. No automatic mutation performed."]),
  ].join("\n"));
}

export function saveHealthAuditReport(root: string, report: MemoryHealthAuditReport): { jsonPath: string; markdownPath: string; snapshotPath: string } {
  const jsonPath = reportPath(root, report.generated_at, "json");
  const markdownPath = reportPath(root, report.generated_at, "md");
  writeFileSync(jsonPath, `${JSON.stringify(redactSecretsInObject(report), null, 2)}\n`, "utf-8");
  writeFileSync(markdownPath, renderHealthAuditReport(report), "utf-8");
  const snapPath = snapshotPath(root);
  appendFileSync(snapPath, `${JSON.stringify(report.snapshot)}\n`, "utf-8");
  return { jsonPath, markdownPath, snapshotPath: snapPath };
}
