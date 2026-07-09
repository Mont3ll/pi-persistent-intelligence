import { readEvidenceRecords } from "./evidence";
import { exportMemoryGraphFromContext } from "./memory-graph";
import { analyzeMemoryQualityFromRecords } from "./memory-quality";
import { analyzeRelationshipQualityFromGraph } from "./relationship-quality";
import { buildStoreQualityReport } from "./store-quality";
import { loadAllRecords } from "./store";
import { redactSecrets, redactSecretsInObject } from "./secret-scanner";
import type { MemoryPatch, MemoryRecord, PatchOp } from "./types";

export interface GovernanceSimulationScorecard {
  memory_quality: number;
  relationship_quality: number;
  store_quality: number;
  memory_count: number;
  active_memory_count: number;
}

export interface GovernanceSimulationReport {
  generated_at: string;
  patch_id: string;
  summary: string;
  applied_op_ids: string[];
  skipped_op_ids: string[];
  affected_memory_ids: string[];
  before: GovernanceSimulationScorecard;
  after: GovernanceSimulationScorecard;
  deltas: {
    memory_quality_delta: number;
    relationship_quality_delta: number;
    store_quality_delta: number;
    memory_count_delta: number;
    active_memory_count_delta: number;
  };
  review_required: true;
  mutation_performed: false;
}

export interface SimulatePatchOptions { now?: string; selectedOpIds?: string[]; }

type MutableMemoryRecord = MemoryRecord;

function isSelected(op: PatchOp, selected?: string[]): boolean {
  return selected ? selected.includes(op.op_id) : op.default_selected;
}

function mergeUnique(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  const merged = [...new Set([...(existing ?? []), ...(incoming ?? [])])];
  return merged.length ? merged : undefined;
}

function replaceRecord(records: MutableMemoryRecord[], id: string, update: (record: MutableMemoryRecord) => MutableMemoryRecord): boolean {
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) return false;
  records[index] = update(records[index]);
  return true;
}

function canPreview(records: MemoryRecord[], op: PatchOp): boolean {
  const byId = new Map(records.map((record) => [record.id, record]));
  if (op.op === "add") return Boolean(op.record && !byId.has(op.record.id));
  if (["update", "update_stability", "flag_for_review", "decay", "deprecate", "contest", "uncontest", "add_exception", "delete"].includes(op.op)) return Boolean(op.target_id && byId.has(op.target_id));
  if (op.op === "supersede") return Boolean(op.target_id && byId.has(op.target_id) && op.to_record && !byId.has(op.to_record.id));
  return false;
}

function previewOp(records: MutableMemoryRecord[], op: PatchOp, now: string): boolean {
  if (!canPreview(records, op)) return false;
  if (op.op === "add" && op.record) {
    records.push({ ...op.record });
    return true;
  }
  if ((op.op === "update" || op.op === "update_stability" || op.op === "flag_for_review" || op.op === "decay") && op.target_id && op.updates) {
    return replaceRecord(records, op.target_id, (record) => ({ ...record, ...op.updates }));
  }
  if (op.op === "deprecate" && op.target_id) {
    return replaceRecord(records, op.target_id, (record) => ({ ...record, status: "deprecated", updated_at: now.slice(0, 10) }));
  }
  if ((op.op === "contest" || op.op === "uncontest") && op.target_id) {
    return replaceRecord(records, op.target_id, (record) => ({ ...record, status: op.op === "contest" ? "contested" : "active", updated_at: now.slice(0, 10) }));
  }
  if (op.op === "add_exception" && op.target_id && op.updates) {
    return replaceRecord(records, op.target_id, (record) => ({
      ...record,
      applies_when: mergeUnique(record.applies_when, op.updates?.applies_when),
      does_not_apply_when: mergeUnique(record.does_not_apply_when, op.updates?.does_not_apply_when),
      known_exceptions: mergeUnique(record.known_exceptions, op.updates?.known_exceptions),
      updated_at: now.slice(0, 10),
    }));
  }
  if (op.op === "delete" && op.target_id) {
    return replaceRecord(records, op.target_id, (record) => ({ ...record, status: "deleted", updated_at: now.slice(0, 10) }));
  }
  if (op.op === "supersede" && op.target_id && op.to_record) {
    const replacement = { ...op.to_record, supersedes: [...new Set([...(op.to_record.supersedes ?? []), op.target_id])], updated_at: now.slice(0, 10) };
    const updated = replaceRecord(records, op.target_id, (record) => ({ ...record, status: "superseded", superseded_by: [...new Set([...record.superseded_by, replacement.id])], updated_at: now.slice(0, 10) }));
    if (updated) records.push(replacement);
    return updated;
  }
  return false;
}

function scorecard(records: MemoryRecord[], evidence: ReturnType<typeof readEvidenceRecords>, now: string): GovernanceSimulationScorecard {
  const memory = analyzeMemoryQualityFromRecords(records, evidence, now);
  const graph = exportMemoryGraphFromContext({ generated_at: now, memories: records, evidence });
  const relationships = analyzeRelationshipQualityFromGraph({ generated_at: now, graph, records, evidence });
  const store = buildStoreQualityReport({ generated_at: now, memory, relationships, recall: { generated_at: now, summary: { total_events: 0, selected_memory_count: 0, never_recalled_count: 0, corrected_after_recall_count: 0, average_effectiveness: 100 }, memory_stats: [], recommendations: [], mutation_performed: false }, activeMemories: records.filter((record) => record.status === "active").length, pendingCandidates: 0, runtimeWarnings: 0 });
  return {
    memory_quality: memory.summary.average_quality,
    relationship_quality: relationships.summary.average_relationship_quality,
    store_quality: store.overall_score,
    memory_count: records.length,
    active_memory_count: records.filter((record) => record.status === "active").length,
  };
}

export function simulatePatchImpact(root: string, patch: MemoryPatch, options: SimulatePatchOptions = {}): GovernanceSimulationReport {
  const now = options.now ?? new Date().toISOString();
  const beforeRecords = loadAllRecords(root);
  const evidence = readEvidenceRecords(root);
  const previewRecords = JSON.parse(JSON.stringify(beforeRecords)) as MemoryRecord[];
  const applied: string[] = [];
  const skipped: string[] = [];
  const affected = new Set<string>();

  for (const op of patch.ops) {
    if (!isSelected(op, options.selectedOpIds)) { skipped.push(op.op_id); continue; }
    const ok = previewOp(previewRecords, op, now);
    if (ok) {
      applied.push(op.op_id);
      for (const id of [op.target_id, op.record?.id, op.to_record?.id].filter(Boolean) as string[]) affected.add(id);
    } else skipped.push(op.op_id);
  }

  const before = scorecard(beforeRecords, evidence, now);
  const after = scorecard(previewRecords, evidence, now);
  return redactSecretsInObject({
    generated_at: now,
    patch_id: patch.patch_id,
    summary: patch.summary,
    applied_op_ids: applied,
    skipped_op_ids: skipped,
    affected_memory_ids: [...affected].sort(),
    before,
    after,
    deltas: {
      memory_quality_delta: after.memory_quality - before.memory_quality,
      relationship_quality_delta: after.relationship_quality - before.relationship_quality,
      store_quality_delta: after.store_quality - before.store_quality,
      memory_count_delta: after.memory_count - before.memory_count,
      active_memory_count_delta: after.active_memory_count - before.active_memory_count,
    },
    review_required: true,
    mutation_performed: false,
  }) as GovernanceSimulationReport;
}

export function renderGovernanceSimulationReport(report: GovernanceSimulationReport): string {
  const signed = (value: number) => `${value >= 0 ? "+" : ""}${value}`;
  return redactSecrets([
    "# PI Governance Simulation Report",
    "",
    `Generated: ${report.generated_at}`,
    `Patch: ${report.patch_id}`,
    `Summary: ${report.summary}`,
    `Applied in simulation: ${report.applied_op_ids.join(", ") || "none"}`,
    `Skipped in simulation: ${report.skipped_op_ids.join(", ") || "none"}`,
    "",
    "## Quality Delta",
    `- Memory quality: ${report.before.memory_quality} → ${report.after.memory_quality} (${signed(report.deltas.memory_quality_delta)})`,
    `- Relationship quality: ${report.before.relationship_quality} → ${report.after.relationship_quality} (${signed(report.deltas.relationship_quality_delta)})`,
    `- Store quality: ${report.before.store_quality} → ${report.after.store_quality} (${signed(report.deltas.store_quality_delta)})`,
    `- Memory count: ${report.before.memory_count} → ${report.after.memory_count} (${signed(report.deltas.memory_count_delta)})`,
    "",
    `Affected memories: ${report.affected_memory_ids.join(", ") || "none"}`,
    "Review required. No automatic mutation performed.",
  ].join("\n"));
}
