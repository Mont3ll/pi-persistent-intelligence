import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { appendCandidate, listCandidates } from "./inbox";
import { appendDeletionTombstone, readDeletionTombstones } from "./tombstones";
import { appendEvidenceRecord, readEvidenceRecords } from "./evidence";
import { appendInquiryRecord, readInquiryRecords } from "./inquiries";
import { appendReinforcementEvent, readReinforcementEvents } from "./reinforcement";
import { loadAllRecords, unsafeAddMemoryRecord } from "./store";
import { ensureMemoryDirs } from "./paths";
import { loadConfig } from "./config";
import { redactSecretsInObject } from "./secret-scanner";
import { appendPortableEvent, readPortableEvents } from "./portable-events";
import type { CaptureCandidate, DeletionTombstone, DurabilitySignal, EvidenceRecord, EvidenceTrustClass, InquiryRecord, MemoryKind, MemoryPatch, MemoryRecord, MemoryRuleType, PortablePeerEvent, ReinforcementEvent } from "./types";

export type PiGovernanceLayer = "l1_identity" | "l2_playbook" | "l3_session";
export type PiGovernanceRecordStatus = "active" | "contested" | "superseded" | "tombstoned" | "deleted";
export type PiGovernancePatchStatus = "proposed" | "applied" | "rejected" | "deferred";

export interface PiGovernanceRecord {
  id: string;
  namespace: string;
  profile_id?: string;
  project?: string;
  class?: string;
  layer: PiGovernanceLayer;
  claim: string;
  status: PiGovernanceRecordStatus;
  memory_kind: MemoryKind;
  rule_type?: MemoryRuleType;
  trust_class?: EvidenceTrustClass | "unknown";
  durability?: DurabilitySignal;
  source_kind?: string;
  confidence: number;
  evidence_ids: string[];
  evidence?: Array<{ schema_version?: 1; kind: string; uri: string; note?: string | null; trust_class?: string; durability?: string; source_kind?: string }>;
  scope?: { level: "global" | "project" | "domain"; key?: string | null };
  tags: string[];
  created_at?: string;
  updated_at?: string;
  supersedes?: string[];
  superseded_by?: string[];
  verification?: Record<string, unknown>;
}

export interface PiGovernancePatch {
  id: string;
  status: PiGovernancePatchStatus;
  operation: string;
  claim?: string;
  layer?: PiGovernanceLayer;
  memory_kind?: MemoryKind;
  rule_type?: MemoryRuleType;
  tags?: string[];
  candidate_id?: string;
  target_id?: string | null;
  proposed_record?: PiGovernanceRecord | null;
  reason?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PiGovernanceSessionEntry {
  id: string;
  namespace: string;
  profile_id?: string;
  project?: string;
  layer: "l3_session";
  text: string;
  created_at?: string;
  source_kind: "daily_log" | "session_entry";
}

const IMPORTED_SESSION_EVENT_KIND = "pi_governance_session_v1";

interface ImportedSessionEvent extends PortablePeerEvent {
  id: string;
  kind: typeof IMPORTED_SESSION_EVENT_KIND;
  session: PiGovernanceSessionEntry;
}

function importedSessionEvent(session: PiGovernanceSessionEntry): ImportedSessionEvent {
  return {
    id: `pi-governance-session:${session.namespace}:${session.id}`,
    kind: IMPORTED_SESSION_EVENT_KIND,
    session,
  };
}

function importedSessionFromEvent(event: PortablePeerEvent): PiGovernanceSessionEntry | null {
  if (event.kind !== IMPORTED_SESSION_EVENT_KIND || !event.session || typeof event.session !== "object") return null;
  const session = event.session as Record<string, unknown>;
  if (
    typeof session.id !== "string"
    || typeof session.namespace !== "string"
    || session.layer !== "l3_session"
    || typeof session.text !== "string"
    || !["daily_log", "session_entry"].includes(String(session.source_kind))
  ) return null;
  const typed = session as unknown as PiGovernanceSessionEntry;
  return event.id === importedSessionEvent(typed).id ? typed : null;
}

export interface PiGovernanceRedactionMetadata {
  enabled: boolean;
  fields_checked: string[];
  fields_redacted: string[];
  notes: string[];
}

export interface PiGovernanceBundle {
  schema_version: 1;
  format: "pi-governance";
  producer: { name: string; version: string };
  exported_at?: string;
  redacted?: boolean;
  namespace?: string;
  all_namespaces?: boolean;
  project?: string | null;
  records: PiGovernanceRecord[];
  patches: PiGovernancePatch[];
  evidence: Array<Record<string, unknown>>;
  inquiries: InquiryRecord[];
  sessions: PiGovernanceSessionEntry[];
  reinforcement: ReinforcementEvent[];
  events?: PortablePeerEvent[];
  tombstones: DeletionTombstone[];
  redaction: PiGovernanceRedactionMetadata;
  warnings?: string[];
}

export interface PiGovernanceExportOptions {
  namespace?: string;
  project?: string;
  profile_id?: string;
  redacted?: boolean;
  includePrivateSessions?: boolean;
}

export interface PortableSelection {
  records: MemoryRecord[];
  candidates: CaptureCandidate[];
  evidence: EvidenceRecord[];
  inquiries: InquiryRecord[];
  sessions: PiGovernanceSessionEntry[];
  reinforcement: ReinforcementEvent[];
  tombstones: DeletionTombstone[];
  events: PortablePeerEvent[];
  warnings: string[];
}

export interface PiGovernanceImportOptions { dryRun?: boolean; backup?: boolean; redactedAware?: boolean; namespace?: string; project?: string; profile_id?: string }

export interface PiGovernanceImportResult {
  dry_run: boolean;
  planned: { records_to_add: number; records_skipped_existing: number; candidates_to_add: number; evidence_to_add: number; inquiries_to_add: number; reinforcement_to_add: number; tombstones_to_add: number; sessions_to_add: number; events_to_add: number };
  applied: { records_added: number; records_skipped_existing: number; candidates_added: number; evidence_added: number; inquiries_added: number; reinforcement_added: number; tombstones_added: number; sessions_added: number; events_added: number };
  backup_path?: string;
  warnings: string[];
}

export interface PiGovernanceDoctorReport {
  ok: boolean;
  status: "disabled" | "pass" | "fail";
  message: string;
  checks: Array<{ name: string; ok: boolean; message: string }>;
}

const PRODUCER_VERSION = "0.16.0";

function normalizeTimestamp(value?: string): string {
  if (!value) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid portable timestamp: ${value}`);
  return parsed.toISOString();
}

function mapLayer(layer: MemoryRecord["layer"]): PiGovernanceLayer {
  if (layer === "L1") return "l1_identity";
  if (layer === "L2") return "l2_playbook";
  return "l3_session";
}

function unmapLayer(layer: PiGovernanceLayer): MemoryRecord["layer"] {
  if (layer === "l1_identity") return "L1";
  if (layer === "l2_playbook") return "L2";
  return "L3";
}

function mapRecordStatus(status: MemoryRecord["status"]): PiGovernanceRecordStatus {
  if (status === "deprecated") return "tombstoned";
  if (status === "deleted") return "tombstoned";
  if (status === "promoted") return "active";
  return status;
}

function mapCandidateStatus(status: CaptureCandidate["status"]): PiGovernancePatchStatus {
  if (status === "new") return "proposed";
  if (status === "patched") return "applied";
  return "rejected";
}

function sourceKindFromEvidence(record: MemoryRecord): string {
  const kind = record.evidence[0]?.type;
  if (kind === "manual") return "manual_cli";
  if (kind === "conversation") return "session_text";
  if (kind === "test_result") return "codebase_analysis";
  return "unknown";
}

function evidenceKindForRust(kind: string): string {
  if (kind === "manual") return "conversation";
  if (kind === "test_result") return "test";
  if (kind === "source") return "file";
  if (kind === "artifact") return "file";
  return ["conversation", "file", "url", "test", "commit", "user_correction", "human_review"].includes(kind) ? kind : "conversation";
}

function classFromRecord(record: MemoryRecord): string {
  if (record.ruleType === "preference" || record.ruleType === "prefer_pattern") return "preference";
  if (record.ruleType === "correction" || record.ruleType === "avoid_pattern") return "correction";
  if (record.ruleType === "workflow" || record.ruleType === "testing" || record.ruleType === "tool") return "workflow";
  if (record.ruleType === "architecture" || record.ruleType === "convention") return "requirement";
  return record.memory_kind === "event" ? "observation" : "workflow";
}

function projectFromRecord(record: MemoryRecord, fallback?: string): string | undefined {
  return record.scope.type === "project" ? record.scope.project : fallback;
}

function evidenceIds(record: MemoryRecord): string[] {
  return record.evidence.map((e) => e.ref).filter(Boolean);
}

function redactEvidence(record: EvidenceRecord, metadata: PiGovernanceRedactionMetadata): Record<string, unknown> {
  metadata.fields_checked.push("evidence.source_summary", "evidence.source_excerpt", "evidence.source_ref");
  const redacted = redactSecretsInObject(record) as Record<string, unknown>;
  redacted.source_summary = "redacted";
  metadata.fields_redacted.push("evidence.source_summary");
  if ("source_ref" in redacted) {
    redacted.source_ref = "redacted:evidence";
    metadata.fields_redacted.push("evidence.source_ref");
  }
  if ("source_excerpt" in redacted) {
    delete redacted.source_excerpt;
    metadata.fields_redacted.push("evidence.source_excerpt");
  }
  return redacted;
}

function readDailySessions(root: string, options: PiGovernanceExportOptions): PiGovernanceSessionEntry[] {
  if (options.redacted && !options.includePrivateSessions) return [];
  const paths = ensureMemoryDirs(root);
  if (!existsSync(paths.daily)) return [];
  return readdirSync(paths.daily)
    .filter((name) => name.endsWith(".md"))
    .flatMap((name) => {
      const date = basename(name, ".md");
      const text = readFileSync(join(paths.daily, name), "utf-8").trim();
      if (!text) return [];
      return text.split(/\n{2,}/).map((entry, index) => ({
        id: `daily_${date}_${index + 1}`,
        namespace: options.namespace ?? "default",
        layer: "l3_session" as const,
        text: entry.trim(),
        created_at: `${date}T00:00:00Z`,
        source_kind: "daily_log" as const,
      }));
    });
}

function recordMatchesFilters(record: MemoryRecord, options: PiGovernanceExportOptions): boolean {
  if (options.profile_id && record.profile_id !== options.profile_id) return false;
  if (!options.project) return true;
  if (record.scope.type === "global") return true;
  return record.scope.type === "project" && record.scope.project === options.project;
}

function relatedToSelection(ids: string[] | undefined, selectedIds: Set<string>): boolean {
  return (ids ?? []).some((id) => selectedIds.has(id));
}

function explicitlyMatchesFilters(
  value: { profile_id?: string; project?: string; scope_level?: string; scope_ref?: string },
  options: PiGovernanceExportOptions,
): boolean {
  if (options.profile_id && value.profile_id !== options.profile_id) return false;
  if (options.project) {
    if (value.project !== options.project && !(value.scope_level === "project" && value.scope_ref === options.project)) return false;
  }
  return !!(options.profile_id || options.project);
}

function selectPortableArtifacts(root: string, options: PiGovernanceExportOptions): PortableSelection {
  const records = loadAllRecords(root).filter((record) => recordMatchesFilters(record, options));
  const selectedIds = new Set(records.map((record) => record.id));
  const filtered = !!(options.profile_id || options.project);
  const portableEvents = readPortableEvents(root);
  const importedSessions: PiGovernanceSessionEntry[] = [];
  const genericEvents: PortablePeerEvent[] = [];
  for (const event of portableEvents) {
    const session = importedSessionFromEvent(event);
    if (session) importedSessions.push(session);
    else genericEvents.push(event);
  }
  const allSessions = options.redacted && !options.includePrivateSessions
    ? []
    : [...readDailySessions(root, options), ...importedSessions];
  const sessions = filtered
    ? allSessions.filter((session) => explicitlyMatchesFilters(session, options))
    : allSessions;
  const omittedSessions = allSessions.length - sessions.length;
  const warnings = omittedSessions > 0
    ? [`Omitted ${omittedSessions} unscoped daily session entr${omittedSessions === 1 ? "y" : "ies"} because project/profile filters were requested.`]
    : [];

  return {
    records,
    candidates: listCandidates(root).filter((candidate) => !filtered
      || relatedToSelection(candidate.matched_memory_ids, selectedIds)
      || explicitlyMatchesFilters(candidate, options)),
    evidence: readEvidenceRecords(root).filter((item) => !filtered
      || relatedToSelection(item.related_memory_ids, selectedIds)
      || explicitlyMatchesFilters(item, options)),
    inquiries: readInquiryRecords(root).filter((item) => !filtered
      || relatedToSelection(item.related_memory_ids, selectedIds)
      || explicitlyMatchesFilters(item, options)),
    sessions,
    reinforcement: readReinforcementEvents(root).filter((item) => !filtered
      || selectedIds.has(item.memory_id)
      || explicitlyMatchesFilters(item, options)),
    tombstones: readDeletionTombstones(root).filter((item) => !filtered
      || selectedIds.has(item.deleted_record_id)
      || explicitlyMatchesFilters(item, options)),
    events: genericEvents.filter((item) => !filtered
      || (typeof item.object_id === "string" && selectedIds.has(item.object_id))
      || explicitlyMatchesFilters(item as { profile_id?: string; project?: string; scope_level?: string; scope_ref?: string }, options)),
    warnings,
  };
}

export function exportToPiGovernanceBundle(root: string, options: PiGovernanceExportOptions = {}): PiGovernanceBundle {
  const namespace = options.namespace ?? "default";
  const selection = selectPortableArtifacts(root, options);
  const redaction: PiGovernanceRedactionMetadata = { enabled: !!options.redacted, fields_checked: [], fields_redacted: [], notes: [] };
  const records = selection.records.map((record): PiGovernanceRecord => ({
    id: record.id,
    namespace,
    profile_id: record.profile_id,
    project: projectFromRecord(record),
    class: classFromRecord(record),
    layer: mapLayer(record.layer),
    claim: record.statement,
    status: mapRecordStatus(record.status),
    memory_kind: record.memory_kind ?? "fact",
    rule_type: record.ruleType,
    trust_class: undefined,
    durability: undefined,
    source_kind: sourceKindFromEvidence(record),
    confidence: record.confidence,
    evidence_ids: evidenceIds(record),
    evidence: record.evidence.map((e) => ({ schema_version: 1 as const, kind: evidenceKindForRust(e.type), uri: e.ref, note: e.note || null, trust_class: "unknown", durability: "unknown", source_kind: "unknown" })),
    scope: record.scope.type === "project" ? { level: "project", key: record.scope.project ?? null } : record.scope.type === "domain" ? { level: "domain", key: record.scope.domains?.[0] ?? null } : { level: "global", key: null },
    tags: record.tags,
    created_at: normalizeTimestamp(record.created_at),
    updated_at: normalizeTimestamp(record.updated_at),
    supersedes: record.supersedes,
    superseded_by: record.superseded_by,
    verification: { review: record.review, stability: record.stability },
  }));

  for (const record of records) {
    const relatedEvidence = readEvidenceRecords(root).filter((e) => record.evidence_ids.includes(e.id));
    record.trust_class = relatedEvidence[0]?.trust_class ?? "unknown";
    record.durability = relatedEvidence[0]?.durability_signal ?? "unknown";
  }

  const patches = selection.candidates.map((candidate): PiGovernancePatch => ({
    id: candidate.source.type === "pi-governance" ? candidate.source.ref : candidate.id,
    status: mapCandidateStatus(candidate.status),
    operation: "propose_record",
    claim: candidate.text,
    layer: "l2_playbook",
    memory_kind: candidate.memory_kind,
    rule_type: candidate.ruleType,
    tags: candidate.tags,
    candidate_id: candidate.id,
    target_id: candidate.matched_memory_ids?.[0],
  }));

  const evidence = selection.evidence.map((record) => {
    if (options.redacted) return redactEvidence(record, redaction);
    if (record.notes !== "capture_evidence_v1") return { ...record };
    return { ...record, source_session_id: undefined, source_ref: `capture-evidence:${record.id}` };
  });
  const inquiries = selection.inquiries.map((item) => ({ ...item }));
  const reinforcement = selection.reinforcement.map((item) => ({ ...item }));
  const tombstones = selection.tombstones.map((item) => ({ ...item })) as Array<DeletionTombstone & Record<string, unknown>>;
  const events = options.redacted ? [] : selection.events;
  const warnings = [...selection.warnings];
  if (options.redacted) {
    redaction.notes.push("Redacted export is best-effort and should be user-reviewed before sharing.");
    redaction.fields_checked.push(
      "records.evidence", "patches.claim", "patches.evidence", "inquiries.question", "inquiries.context",
      "reinforcement.notes", "tombstones.content", "tombstones.content_hash", "events",
    );
    for (const record of records) {
      for (const item of record.evidence ?? []) {
        item.uri = "redacted:evidence";
        if (item.note) item.note = "redacted";
      }
    }
    if (records.some((record) => (record.evidence?.length ?? 0) > 0)) redaction.fields_redacted.push("records.evidence");
    for (const patch of patches) {
      if (patch.claim) patch.claim = "redacted";
      for (const item of patch.proposed_record?.evidence ?? []) {
        item.uri = "redacted:evidence";
        if (item.note) item.note = "redacted";
      }
      if (patch.proposed_record) patch.proposed_record.claim = "redacted";
    }
    if (patches.length > 0) redaction.fields_redacted.push("patches.claim", "patches.evidence");
    for (const inquiry of inquiries) {
      inquiry.question = "redacted";
      inquiry.context = "redacted";
    }
    if (inquiries.length > 0) redaction.fields_redacted.push("inquiries.question", "inquiries.context");
    for (const item of reinforcement) {
      if (item.notes) item.notes = "redacted";
    }
    if (reinforcement.some((item) => !!item.notes)) redaction.fields_redacted.push("reinforcement.notes");
    for (const tombstone of tombstones) {
      delete tombstone.content;
      delete tombstone.content_hash;
    }
    if (tombstones.length > 0) redaction.fields_redacted.push("tombstones.content", "tombstones.content_hash");
    if (selection.events.length > 0) {
      redaction.fields_redacted.push("events.omitted");
      redaction.notes.push(`${selection.events.length} opaque peer event(s) omitted because their payload schema is not governed by this runtime.`);
      warnings.push("Opaque peer events omitted from redacted export.");
    }
  }

  return {
    schema_version: 1,
    format: "pi-governance",
    producer: { name: "pi-persistent-intelligence", version: PRODUCER_VERSION },
    exported_at: new Date().toISOString(),
    redacted: !!options.redacted,
    namespace,
    all_namespaces: false,
    project: options.project ?? null,
    records,
    patches,
    evidence,
    inquiries,
    sessions: selection.sessions,
    reinforcement,
    events,
    tombstones,
    redaction,
    warnings,
  };
}

function recordFromPi(record: PiGovernanceRecord, fallback: PiGovernanceImportOptions): MemoryRecord | null {
  const layer = unmapLayer(record.layer);
  if (layer === "L3") return null;
  const scope: MemoryRecord["scope"] = record.scope?.level === "domain"
    ? { type: "domain", domains: record.scope.key ? [record.scope.key] : [] }
    : record.scope?.level === "global"
      ? { type: "global" }
      : record.scope?.level === "project"
        ? { type: "project", project: record.scope.key ?? record.project ?? fallback.project }
        : record.project ?? fallback.project
          ? { type: "project", project: record.project ?? fallback.project }
          : { type: "global" };
  return {
    id: record.id,
    profile_id: record.profile_id ?? fallback.profile_id,
    layer,
    scope,
    tags: record.tags ?? [],
    statement: record.claim,
    evidence: (record.evidence_ids?.length ? record.evidence_ids : record.evidence?.map((e) => e.uri).filter(Boolean) ?? [`pi-governance:${record.id}`]).map((id) => ({ type: "manual", ref: id, note: "Imported from pi-governance bundle." })),
    confidence: record.confidence ?? 0.7,
    stability: "low",
    created_at: normalizeTimestamp(record.created_at),
    updated_at: normalizeTimestamp(record.updated_at),
    review: { cadence_days: 30, next_review: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10), change_condition: "Imported memory should be reviewed before relying on it." },
    status: record.status === "deleted" ? "deleted" : record.status === "tombstoned" ? "deleted" : record.status,
    supersedes: record.supersedes ?? [],
    superseded_by: record.superseded_by ?? [],
    vault_ref: null,
    ruleType: record.rule_type,
    memory_kind: record.memory_kind,
  };
}

function candidateFromPatch(patch: PiGovernancePatch, fallback: PiGovernanceImportOptions): CaptureCandidate | null {
  const proposed = patch.proposed_record ?? undefined;
  return {
    id: patch.id,
    profile_id: proposed?.profile_id ?? fallback.profile_id,
    created_at: normalizeTimestamp(patch.created_at),
    source: { type: "pi-governance", ref: patch.id },
    text: patch.claim ?? proposed?.claim ?? `Imported pi-governance patch ${patch.id}`,
    tags: patch.tags ?? proposed?.tags ?? [],
    evidence_refs: proposed?.evidence_ids ?? proposed?.evidence?.map((item) => item.uri) ?? [],
    confidence: proposed?.confidence ?? 0.7,
    status: patch.status === "applied" ? "patched" : patch.status === "rejected" ? "rejected" : "new",
    ruleType: patch.rule_type ?? proposed?.rule_type,
    memory_kind: patch.memory_kind ?? proposed?.memory_kind,
    primary_trust_class: "agent_inference",
    durability_signal: "project",
    verification_status: "review_required",
    matched_memory_ids: patch.target_id ? [patch.target_id] : [],
  };
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] as string : undefined;
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  return Array.isArray(value[key]) ? (value[key] as unknown[]).filter((item): item is string => typeof item === "string") : [];
}

function normalizedPortableTimestamp(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (!value) continue;
    try {
      return normalizeTimestamp(value);
    } catch {
      // Continue to the bundle-level fallback.
    }
  }
  return undefined;
}

function hasOnlyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const EVIDENCE_SOURCE_KINDS = new Set<EvidenceRecord["source_kind"]>([
  "conversation", "tool_result", "file", "patch", "test_result", "generated_content", "external_document", "codebase_analysis",
]);
const EVIDENCE_TRUST_CLASSES = new Set<EvidenceRecord["trust_class"]>([
  "direct_user_instruction", "user_correction", "repeated_user_preference", "accepted_code_review_outcome",
  "existing_project_convention", "passing_tool_or_test_outcome", "agent_inference", "single_session_observation",
  "repository_text", "generated_content", "third_party_documentation", "unknown",
]);
const EVIDENCE_POLARITIES = new Set<EvidenceRecord["polarity"]>(["supports", "contradicts", "qualifies"]);
const DURABILITY_SIGNALS = new Set<NonNullable<EvidenceRecord["durability_signal"]>>([
  "temporary", "session", "task", "project", "repository", "user_global", "long_term", "unknown",
]);
const INQUIRY_STATUSES = new Set<InquiryRecord["status"]>(["open", "answered", "withdrawn", "stale"]);
const INQUIRY_PRIORITIES = new Set<InquiryRecord["priority"]>(["low", "medium", "high"]);

function relatedMemoryIds(value: Record<string, unknown>): string[] {
  const ids = [
    ...stringArrayField(value, "related_memory_ids"),
    ...stringArrayField(value, "record_ids"),
    stringField(value, "record_id"),
  ].filter((item): item is string => !!item);
  return [...new Set(ids)];
}

function normalizeImportedEvidence(value: Record<string, unknown>, options: PiGovernanceImportOptions, fallbackTime?: string): EvidenceRecord | null {
  const id = stringField(value, "id");
  if (!id) return null;
  const createdAt = normalizedPortableTimestamp(stringField(value, "created_at"), fallbackTime);
  if (!createdAt) return null;
  const sourceKind = stringField(value, "source_kind") as EvidenceRecord["source_kind"] | undefined;
  const trustClass = stringField(value, "trust_class") as EvidenceRecord["trust_class"] | undefined;
  const polarity = stringField(value, "polarity") as EvidenceRecord["polarity"] | undefined;
  const durability = stringField(value, "durability_signal") as EvidenceRecord["durability_signal"] | undefined;
  if (
    stringField(value, "resource_id")
    && stringField(value, "profile_id")
    && stringField(value, "source_summary")
    && sourceKind && EVIDENCE_SOURCE_KINDS.has(sourceKind)
    && trustClass && EVIDENCE_TRUST_CLASSES.has(trustClass)
    && polarity && EVIDENCE_POLARITIES.has(polarity)
    && (!durability || DURABILITY_SIGNALS.has(durability))
    && hasOnlyStrings(value.related_memory_ids)
    && (value.tags === undefined || hasOnlyStrings(value.tags))
    && (value.redaction_status === undefined || ["none", "redacted", "deleted"].includes(String(value.redaction_status)))
  ) return { ...value, created_at: createdAt } as unknown as EvidenceRecord;

  return {
    id,
    resource_id: stringField(value, "resource_id") ?? "pi-governance-import",
    profile_id: stringField(value, "profile_id") ?? options.profile_id ?? "default",
    created_at: createdAt,
    source_kind: "external_document",
    source_ref: `pi-governance:${id}`,
    source_summary: stringField(value, "source_summary") ?? `Imported peer evidence ${id}.`,
    trust_class: "unknown",
    polarity: "qualifies",
    durability_signal: "unknown",
    related_memory_ids: relatedMemoryIds(value),
    scope_level: stringField(value, "scope_level"),
    scope_ref: stringField(value, "scope_ref"),
    tags: stringArrayField(value, "tags").length > 0 ? stringArrayField(value, "tags") : ["pi-governance-import"],
    notes: "pi_governance_import_v1",
  };
}

function normalizeImportedInquiry(value: Record<string, unknown>, options: PiGovernanceImportOptions, fallbackTime?: string): InquiryRecord | null {
  const id = stringField(value, "id");
  if (!id) return null;
  const firstSeen = normalizedPortableTimestamp(stringField(value, "first_seen"));
  const lastSeen = normalizedPortableTimestamp(stringField(value, "last_seen"));
  const status = stringField(value, "status") as InquiryRecord["status"] | undefined;
  const priority = stringField(value, "priority") as InquiryRecord["priority"] | undefined;
  if (
    stringField(value, "question")
    && stringField(value, "context")
    && hasOnlyStrings(value.tags)
    && hasOnlyStrings(value.sessions_touched)
    && firstSeen && lastSeen
    && status && INQUIRY_STATUSES.has(status)
    && priority && INQUIRY_PRIORITIES.has(priority)
    && (value.related_memory_ids === undefined || hasOnlyStrings(value.related_memory_ids))
    && (value.related_evidence_ids === undefined || hasOnlyStrings(value.related_evidence_ids))
  ) return value as unknown as InquiryRecord;

  const timestamp = normalizedPortableTimestamp(stringField(value, "created_at"), fallbackTime);
  if (!timestamp) return null;
  return {
    id,
    resource_id: stringField(value, "resource_id"),
    profile_id: stringField(value, "profile_id") ?? options.profile_id,
    question: stringField(value, "question") ?? `Imported peer inquiry ${id}.`,
    context: stringField(value, "context") ?? "Imported peer inquiry.",
    scope_level: stringField(value, "scope_level"),
    scope_ref: stringField(value, "scope_ref"),
    tags: stringArrayField(value, "tags"),
    related_memory_ids: relatedMemoryIds(value),
    related_evidence_ids: stringArrayField(value, "related_evidence_ids"),
    sessions_touched: stringArrayField(value, "sessions_touched"),
    first_seen: timestamp,
    last_seen: timestamp,
    status: status && INQUIRY_STATUSES.has(status) ? status : "open",
    priority: "low",
    answer_memory_id: stringField(value, "answer_memory_id"),
  };
}

function normalizeImportedReinforcement(value: Record<string, unknown>, options: PiGovernanceImportOptions, fallbackTime?: string): ReinforcementEvent | null {
  const id = stringField(value, "id");
  const memoryId = stringField(value, "memory_id");
  const outcome = stringField(value, "outcome") ?? stringField(value, "signal");
  const timestamp = normalizedPortableTimestamp(stringField(value, "timestamp"), stringField(value, "created_at"), fallbackTime);
  if (!id || !memoryId || !timestamp || !["explicit_reinforcement", "implicit_success", "neutral_exposure", "explicit_correction"].includes(outcome ?? "")) return null;
  return {
    id,
    resource_id: stringField(value, "resource_id"),
    profile_id: stringField(value, "profile_id") ?? options.profile_id,
    thread_id: stringField(value, "thread_id"),
    memory_id: memoryId,
    timestamp,
    outcome: outcome as ReinforcementEvent["outcome"],
    evidence_id: stringField(value, "evidence_id"),
    notes: stringField(value, "notes"),
  };
}

function canonicalPortableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalPortableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalPortableValue(child)]));
}

const RUST_EVIDENCE_KINDS = new Set(["conversation", "file", "url", "test", "commit", "user_correction", "human_review"]);
const RUST_EVIDENCE_TRUST_CLASSES = new Set([
  "direct_user_instruction", "user_correction", "agent_inference", "repository_text", "generated_content",
  "third_party_documentation", "codebase_analysis", "human_review", "unknown",
]);
const RUST_EVIDENCE_DURABILITY = new Set(["temporary", "task", "project", "long_term", "unknown"]);
const RUST_EVIDENCE_SOURCE_KINDS = new Set([
  "manual_cli", "manual_mcp", "session_text", "transcript_file", "stdin", "agent_observation",
  "codebase_analysis", "imported_bundle", "unknown",
]);

function normalizedRustEnum(value: string | undefined, allowed: Set<string>, fallback: string): string {
  return value && allowed.has(value) ? value : fallback;
}

function canonicalIncomingRecord(record: PiGovernanceRecord): unknown {
  const raw = record as unknown as Record<string, unknown>;
  return canonicalPortableValue({
    schema_version: typeof raw.schema_version === "number" ? raw.schema_version : 1,
    namespace: record.namespace ?? "default",
    id: record.id,
    profile_id: record.profile_id ?? null,
    project: record.project ?? null,
    class: record.class ?? "workflow",
    claim: record.claim,
    evidence: (record.evidence ?? []).map((item) => ({
      schema_version: item.schema_version ?? 1,
      kind: normalizedRustEnum(item.kind, RUST_EVIDENCE_KINDS, "conversation"),
      uri: item.uri ?? "imported:portable-evidence",
      note: item.note ?? null,
      trust_class: normalizedRustEnum(item.trust_class, RUST_EVIDENCE_TRUST_CLASSES, "unknown"),
      durability: normalizedRustEnum(item.durability, RUST_EVIDENCE_DURABILITY, "unknown"),
      source_kind: normalizedRustEnum(item.source_kind, RUST_EVIDENCE_SOURCE_KINDS, "unknown"),
    })),
    evidence_ids: record.evidence_ids ?? [],
    confidence: record.confidence,
    status: record.status === "deleted" ? "tombstoned" : record.status,
    layer: record.layer,
    memory_kind: record.memory_kind ?? null,
    rule_type: record.rule_type ?? null,
    trust_class: record.trust_class ?? "unknown",
    durability: record.durability ?? "unknown",
    source_kind: record.source_kind ?? "unknown",
    scope: record.scope ?? { level: "global", key: null },
    tags: record.tags ?? [],
    supersedes: record.supersedes ?? [],
    superseded_by: record.superseded_by ?? [],
    verification: record.verification ?? null,
    created_at: normalizeTimestamp(record.created_at),
    updated_at: normalizeTimestamp(record.updated_at),
  });
}

function selectIncomingRecords(
  sourceRecords: PiGovernanceRecord[],
  existingIds: Set<string>,
  options: PiGovernanceImportOptions,
): { records: MemoryRecord[]; warnings: string[] } {
  const groups = new Map<string, PiGovernanceRecord[]>();
  for (const record of sourceRecords) {
    const group = groups.get(record.id) ?? [];
    group.push(record);
    groups.set(record.id, group);
  }

  const records: MemoryRecord[] = [];
  const warnings: string[] = [];
  for (const [id, group] of groups) {
    if (existingIds.has(id)) continue;
    const materializedGroup = group.map((record) => recordFromPi(record, options));
    const forms = new Set(group.map((record) => JSON.stringify(canonicalIncomingRecord(record))));
    if (forms.size > 1) {
      warnings.push(`Quarantined ${group.length} divergent incoming rows for record ${id}.`);
      continue;
    }
    if (group.length > 1) {
      warnings.push(`Collapsed ${group.length} equivalent incoming rows for record ${id}.`);
    }
    const materialized = materializedGroup[0];
    if (materialized && materialized.status !== "deleted") records.push(materialized);
  }
  return { records, warnings };
}

function selectIncomingArtifacts<T extends { id: string }>(
  source: T[],
  existingIds: Set<string>,
  label: string,
): { items: T[]; warnings: string[] } {
  const groups = new Map<string, T[]>();
  for (const item of source) {
    if (!item.id) continue;
    const group = groups.get(item.id) ?? [];
    group.push(item);
    groups.set(item.id, group);
  }
  const items: T[] = [];
  const warnings: string[] = [];
  for (const [id, group] of groups) {
    if (existingIds.has(id)) continue;
    const forms = new Set(group.map((item) => JSON.stringify(canonicalPortableValue(item))));
    if (forms.size > 1) {
      warnings.push(`Quarantined ${group.length} divergent incoming ${label} rows for id ${id}.`);
      continue;
    }
    if (group.length > 1) warnings.push(`Collapsed ${group.length} equivalent incoming ${label} rows for id ${id}.`);
    items.push(group[0]);
  }
  return { items, warnings };
}

function createImportBackup(root: string): string {
  const paths = ensureMemoryDirs(root);
  const backup = join(root, "backups", `pi-governance-import-${Date.now()}`);
  mkdirSync(backup, { recursive: true });
  for (const [name, source] of [["memory", paths.memory.dir], ["inbox", paths.inbox.dir], ["daily", paths.daily]] as const) {
    if (existsSync(source)) cpSync(source, join(backup, name), { recursive: true });
  }
  return backup;
}

export function importFromPiGovernanceBundle(root: string, bundle: PiGovernanceBundle, options: PiGovernanceImportOptions = {}): PiGovernanceImportResult {
  if (!!bundle.redacted !== !!bundle.redaction?.enabled) {
    throw new Error("Inconsistent bundle redaction metadata: redacted and redaction.enabled must agree.");
  }
  const dryRun = options.dryRun ?? true;
  const paths = ensureMemoryDirs(root);
  const existingIds = new Set(loadAllRecords(root).map((record) => record.id));
  const existingCandidates = listCandidates(root);
  const existingPatchIds = new Set(existingCandidates.map((candidate) => candidate.source.type === "pi-governance" ? candidate.source.ref : candidate.id));
  const sourceRecords = bundle.records ?? [];
  const sourcePatches = bundle.patches ?? [];
  const artifactWarnings: string[] = [];
  const sourceEvidence: EvidenceRecord[] = [];
  for (const item of bundle.evidence ?? []) {
    const normalized = normalizeImportedEvidence(item, options, bundle.exported_at);
    if (normalized) sourceEvidence.push(normalized);
    else if (typeof item.id === "string") artifactWarnings.push(`Skipped peer evidence ${item.id} because it has no valid timestamp.`);
  }
  const sourceInquiries: InquiryRecord[] = [];
  for (const item of bundle.inquiries ?? []) {
    const raw = item as unknown as Record<string, unknown>;
    const normalized = normalizeImportedInquiry(raw, options, bundle.exported_at);
    if (normalized) sourceInquiries.push(normalized);
    else if (typeof raw.id === "string") artifactWarnings.push(`Skipped peer inquiry ${raw.id} because it has no valid timestamp.`);
  }
  const sourceReinforcement: ReinforcementEvent[] = [];
  for (const item of bundle.reinforcement ?? []) {
    const raw = item as unknown as Record<string, unknown>;
    const normalized = normalizeImportedReinforcement(raw, options, bundle.exported_at);
    if (normalized) sourceReinforcement.push(normalized);
    else if (typeof raw.id === "string") artifactWarnings.push(`Skipped peer reinforcement ${raw.id} because it is invalid or has no valid timestamp.`);
  }
  const sourceTombstones = bundle.tombstones ?? [];
  const sourceEvents: PortablePeerEvent[] = [];
  for (const event of bundle.events ?? []) {
    if (event.kind === IMPORTED_SESSION_EVENT_KIND) {
      artifactWarnings.push(`Rejected peer event ${event.id} because it uses the reserved imported-session marker.`);
    } else {
      sourceEvents.push(event);
    }
  }
  const incomingRecords = selectIncomingRecords(sourceRecords, existingIds, options);
  const recordsToAdd = incomingRecords.records;
  const recordsSkipped = sourceRecords.filter((record) => existingIds.has(record.id)).length;
  const selectedPatches = selectIncomingArtifacts(sourcePatches, existingPatchIds, "patch");
  const candidatesToAdd = selectedPatches.items.map((patch) => candidateFromPatch(patch, options)).filter((candidate): candidate is CaptureCandidate => !!candidate);
  const selectedEvidence = selectIncomingArtifacts(sourceEvidence, new Set(readEvidenceRecords(root).map((record) => record.id)), "evidence");
  const evidenceToAdd = selectedEvidence.items;
  const selectedInquiries = selectIncomingArtifacts(sourceInquiries, new Set(readInquiryRecords(root).map((record) => record.id)), "inquiry");
  const inquiriesToAdd = selectedInquiries.items;
  const selectedReinforcement = selectIncomingArtifacts(sourceReinforcement, new Set(readReinforcementEvents(root).map((event) => event.id)), "reinforcement");
  const reinforcementToAdd = selectedReinforcement.items;
  const existingTombstones = readDeletionTombstones(root);
  const selectedTombstones = selectIncomingArtifacts(sourceTombstones, new Set(existingTombstones.map((item) => item.id)), "tombstone");
  const existingDeletedRecordIds = new Set(existingTombstones.map((item) => item.deleted_record_id));
  const tombstonesToAdd = selectedTombstones.items.filter((item) => !existingDeletedRecordIds.has(item.deleted_record_id));
  const existingDailySessions = new Set(readdirSync(paths.daily).filter((name) => name.endsWith(".md")).flatMap((name) => readFileSync(join(paths.daily, name), "utf-8").split(/\n{2,}/).map((text) => `${basename(name, ".md")}:${text.trim()}`).filter((key) => !key.endsWith(":"))));
  const existingPortableSessionIds = new Set(readPortableEvents(root)
    .map(importedSessionFromEvent)
    .filter((session): session is PiGovernanceSessionEntry => !!session)
    .map((session) => `${session.namespace}:${session.id}`));
  const incomingSessionIds = new Set<string>();
  const sessionsToAdd = (bundle.sessions ?? []).filter((session) => {
    if (!session.id || !session.namespace || !session.text.trim()) return false;
    const stableId = `${session.namespace}:${session.id}`;
    if (existingPortableSessionIds.has(stableId) || incomingSessionIds.has(stableId)) return false;
    const date = normalizedPortableTimestamp(session.created_at)?.slice(0, 10);
    if (date && existingDailySessions.has(`${date}:${session.text.trim()}`)) return false;
    incomingSessionIds.add(stableId);
    return true;
  });
  const selectedEvents = selectIncomingArtifacts(sourceEvents, new Set(readPortableEvents(root).map((event) => event.id)), "event");
  const eventsToAdd = selectedEvents.items;
  artifactWarnings.push(
    ...selectedPatches.warnings,
    ...selectedEvidence.warnings,
    ...selectedInquiries.warnings,
    ...selectedReinforcement.warnings,
    ...selectedTombstones.warnings,
    ...selectedEvents.warnings,
  );

  const result: PiGovernanceImportResult = {
    dry_run: dryRun,
    planned: { records_to_add: recordsToAdd.length, records_skipped_existing: recordsSkipped, candidates_to_add: candidatesToAdd.length, evidence_to_add: evidenceToAdd.length, inquiries_to_add: inquiriesToAdd.length, reinforcement_to_add: reinforcementToAdd.length, tombstones_to_add: tombstonesToAdd.length, sessions_to_add: sessionsToAdd.length, events_to_add: eventsToAdd.length },
    applied: { records_added: 0, records_skipped_existing: recordsSkipped, candidates_added: 0, evidence_added: 0, inquiries_added: 0, reinforcement_added: 0, tombstones_added: 0, sessions_added: 0, events_added: 0 },
    warnings: [...incomingRecords.warnings, ...artifactWarnings],
  };
  if (bundle.redaction?.enabled && !options.redactedAware) result.warnings.push("Bundle is redacted; import remains review-only unless redactedAware is set.");
  if (dryRun) return result;
  const changed = Object.entries(result.planned).some(([key, value]) => key !== "records_skipped_existing" && value > 0);
  if (changed && options.backup) result.backup_path = createImportBackup(root);

  for (const record of recordsToAdd) { unsafeAddMemoryRecord(root, record); result.applied.records_added++; }
  for (const candidate of candidatesToAdd) { appendCandidate(root, candidate); result.applied.candidates_added++; }
  for (const evidence of evidenceToAdd) { appendEvidenceRecord(root, evidence); result.applied.evidence_added++; }
  for (const inquiry of inquiriesToAdd) { appendInquiryRecord(root, inquiry); result.applied.inquiries_added++; }
  for (const event of reinforcementToAdd) { appendReinforcementEvent(root, event); result.applied.reinforcement_added++; }
  for (const tombstone of tombstonesToAdd) { appendDeletionTombstone(root, tombstone); result.applied.tombstones_added++; }
  for (const session of sessionsToAdd) { appendPortableEvent(root, importedSessionEvent(session)); result.applied.sessions_added++; }
  for (const event of eventsToAdd) { appendPortableEvent(root, event); result.applied.events_added++; }
  return result;
}

export function runPiGovernanceDoctor(root: string): PiGovernanceDoctorReport {
  const config = loadConfig(root).piGovernance;
  if (!config.enabled) {
    return {
      ok: true,
      status: "disabled",
      message: "pi-governance-rs bridge is disabled. pi-persistent-intelligence standalone mode is active. This is valid.",
      checks: [{ name: "standalone_mode", ok: true, message: "pi-agent-native memory extension is active without Rust dependency." }],
    };
  }
  const checks = [
    { name: "command_configured", ok: !!config.command, message: config.command ? "command configured" : "command is not configured" },
    { name: "store_configured", ok: !!config.store, message: config.store ? "store configured" : "store is not configured" },
    { name: "namespace_configured", ok: !!config.namespace, message: config.namespace ? `namespace ${config.namespace}` : "namespace is not configured" },
  ];
  return { ok: checks.every((check) => check.ok), status: checks.every((check) => check.ok) ? "pass" : "fail", message: "pi-governance-rs bridge diagnostics completed.", checks };
}
