import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { appendDailyLog } from "./daily";
import { appendCandidate, listCandidates } from "./inbox";
import { appendDeletionTombstone, readDeletionTombstones } from "./tombstones";
import { appendEvidenceRecord, readEvidenceRecords } from "./evidence";
import { appendInquiryRecord, readInquiryRecords } from "./inquiries";
import { appendReinforcementEvent, readReinforcementEvents } from "./reinforcement";
import { loadAllRecords, unsafeAddMemoryRecord } from "./store";
import { ensureMemoryDirs } from "./paths";
import { loadConfig } from "./config";
import { redactSecretsInObject } from "./secret-scanner";
import type { CaptureCandidate, DeletionTombstone, DurabilitySignal, EvidenceRecord, EvidenceTrustClass, InquiryRecord, MemoryKind, MemoryPatch, MemoryRecord, MemoryRuleType, ReinforcementEvent } from "./types";

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
  events?: Array<Record<string, unknown>>;
  tombstones: DeletionTombstone[];
  redaction: PiGovernanceRedactionMetadata;
}

export interface PiGovernanceExportOptions {
  namespace?: string;
  project?: string;
  profile_id?: string;
  redacted?: boolean;
  includePrivateSessions?: boolean;
}

export interface PiGovernanceImportOptions { dryRun?: boolean; backup?: boolean; redactedAware?: boolean; namespace?: string; project?: string; profile_id?: string }

export interface PiGovernanceImportResult {
  dry_run: boolean;
  planned: { records_to_add: number; records_skipped_existing: number; candidates_to_add: number; evidence_to_add: number; inquiries_to_add: number; reinforcement_to_add: number; tombstones_to_add: number; sessions_to_add: number };
  applied: { records_added: number; records_skipped_existing: number; candidates_added: number; evidence_added: number; inquiries_added: number; reinforcement_added: number; tombstones_added: number; sessions_added: number };
  backup_path?: string;
  warnings: string[];
}

export interface PiGovernanceDoctorReport {
  ok: boolean;
  status: "disabled" | "pass" | "fail";
  message: string;
  checks: Array<{ name: string; ok: boolean; message: string }>;
}

const PRODUCER_VERSION = "0.13.0";

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
  if (status === "deleted") return "deleted";
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
  metadata.fields_checked.push("evidence.source_summary", "evidence.source_excerpt");
  const redacted = redactSecretsInObject(record) as Record<string, unknown>;
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
        profile_id: options.profile_id,
        project: options.project,
        layer: "l3_session" as const,
        text: entry.trim(),
        created_at: `${date}T00:00:00Z`,
        source_kind: "daily_log" as const,
      }));
    });
}

export function exportToPiGovernanceBundle(root: string, options: PiGovernanceExportOptions = {}): PiGovernanceBundle {
  const namespace = options.namespace ?? "default";
  const redaction: PiGovernanceRedactionMetadata = { enabled: !!options.redacted, fields_checked: [], fields_redacted: [], notes: [] };
  const records = loadAllRecords(root).map((record): PiGovernanceRecord => ({
    id: record.id,
    namespace,
    profile_id: record.profile_id ?? options.profile_id,
    project: projectFromRecord(record, options.project),
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

  const patches = listCandidates(root).map((candidate): PiGovernancePatch => ({
    id: candidate.id,
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

  const evidence = readEvidenceRecords(root).map((record) => options.redacted ? redactEvidence(record, redaction) : { ...record });
  if (options.redacted) redaction.notes.push("Redacted export is best-effort and should be user-reviewed before sharing.");

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
    inquiries: readInquiryRecords(root),
    sessions: readDailySessions(root, options),
    reinforcement: readReinforcementEvents(root),
    events: [],
    tombstones: readDeletionTombstones(root),
    redaction,
  };
}

function recordFromPi(record: PiGovernanceRecord, fallback: PiGovernanceImportOptions): MemoryRecord | null {
  const layer = unmapLayer(record.layer);
  if (layer === "L3") return null;
  const project = record.project ?? record.scope?.key ?? fallback.project;
  return {
    id: record.id,
    profile_id: record.profile_id ?? fallback.profile_id,
    layer,
    scope: project ? { type: "project", project } : { type: "global" },
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
    id: patch.candidate_id ?? patch.id,
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
  };
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
  const dryRun = options.dryRun ?? true;
  const paths = ensureMemoryDirs(root);
  const existingIds = new Set(loadAllRecords(root).map((record) => record.id));
  const existingCandidateIds = new Set(listCandidates(root).map((candidate) => candidate.id));
  const sourceRecords = bundle.records ?? [];
  const sourcePatches = bundle.patches ?? [];
  const sourceEvidence = (bundle.evidence ?? []).filter((item) => typeof item.id === "string").map((item) => item as unknown as EvidenceRecord);
  const sourceInquiries = bundle.inquiries ?? [];
  const sourceReinforcement = bundle.reinforcement ?? [];
  const sourceTombstones = bundle.tombstones ?? [];
  const recordsToAdd = sourceRecords.map((record) => recordFromPi(record, options)).filter((record): record is MemoryRecord => !!record && !existingIds.has(record.id) && record.status !== "deleted");
  const recordsSkipped = sourceRecords.filter((record) => existingIds.has(record.id)).length;
  const candidatesToAdd = sourcePatches.map((patch) => candidateFromPatch(patch, options)).filter((candidate): candidate is CaptureCandidate => !!candidate && !existingCandidateIds.has(candidate.id));
  const existingEvidenceIds = new Set(readEvidenceRecords(root).map((record) => record.id));
  const evidenceToAdd = sourceEvidence.filter((record) => !existingEvidenceIds.has(record.id));
  const existingInquiryIds = new Set(readInquiryRecords(root).map((record) => record.id));
  const inquiriesToAdd = sourceInquiries.filter((record) => !existingInquiryIds.has(record.id));
  const existingReinforcementIds = new Set(readReinforcementEvents(root).map((event) => event.id));
  const reinforcementToAdd = sourceReinforcement.filter((event) => !existingReinforcementIds.has(event.id));
  const existingTombstones = new Set(readDeletionTombstones(root).map((tombstone) => tombstone.deleted_record_id));
  const tombstonesToAdd = sourceTombstones.filter((tombstone) => !existingTombstones.has(tombstone.deleted_record_id));
  const existingSessions = new Set(readdirSync(paths.daily).filter((name) => name.endsWith(".md")).flatMap((name) => readFileSync(join(paths.daily, name), "utf-8").split(/\n{2,}/).map((text) => `${basename(name, ".md")}:${text.trim()}`).filter((key) => !key.endsWith(":"))));
  const sessionsToAdd = (bundle.sessions ?? []).filter((session) => !existingSessions.has(`${normalizeTimestamp(session.created_at).slice(0, 10)}:${session.text.trim()}`));

  const result: PiGovernanceImportResult = {
    dry_run: dryRun,
    planned: { records_to_add: recordsToAdd.length, records_skipped_existing: recordsSkipped, candidates_to_add: candidatesToAdd.length, evidence_to_add: evidenceToAdd.length, inquiries_to_add: inquiriesToAdd.length, reinforcement_to_add: reinforcementToAdd.length, tombstones_to_add: tombstonesToAdd.length, sessions_to_add: sessionsToAdd.length },
    applied: { records_added: 0, records_skipped_existing: recordsSkipped, candidates_added: 0, evidence_added: 0, inquiries_added: 0, reinforcement_added: 0, tombstones_added: 0, sessions_added: 0 },
    warnings: [],
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
  for (const session of sessionsToAdd) { appendDailyLog(root, normalizeTimestamp(session.created_at).slice(0, 10), session.text); result.applied.sessions_added++; }
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
