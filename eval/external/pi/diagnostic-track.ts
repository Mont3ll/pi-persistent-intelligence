import { createHash } from "node:crypto";
import { join } from "node:path";
import { applyPatch } from "../../../src/patch";
import type { EvidenceRecord, MemoryPatch, MemoryRecord, PatchOp } from "../../../src/types";
import { appendJsonlAtomic } from "../core/artifacts";
import type { BenchmarkHistoryItem, BenchmarkQuery, TrackConfig } from "../core/protocol";
import { retrieveBenchmarkContext } from "./retrieval";
import { claimTrackRoot } from "./track-root";
import type { BenchmarkTrackRunner, TrackInsertTrace, TrackQueryResult } from "./types";

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function diagnosticOperation(caseId: string, item: BenchmarkHistoryItem): PatchOp {
  const digest = hash(`${caseId}\n${item.id}\n${item.role}\n${item.content}`); const memoryId = `mem_benchmark_${digest.slice(0, 24)}`; const date = item.at.slice(0, 10);
  const evidence: EvidenceRecord = {
    id: `ev_benchmark_${digest.slice(0, 24)}`, resource_id: "curation", profile_id: "legacy-default", created_at: item.at,
    source_kind: "external_document", source_ref: `benchmark:${caseId}:${item.id}`, source_summary: item.content.slice(0, 300),
    excerpt_hash: hash(item.content).slice(0, 32), redaction_status: "none", trust_class: "third_party_documentation", polarity: "supports",
    durability_signal: "task", related_memory_ids: [memoryId], scope_level: "global", tags: ["external-benchmark", item.role], notes: "diagnostic_substrate_v1",
  };
  const record: MemoryRecord = {
    id: memoryId, layer: "L2", scope: { type: "global" }, tags: ["external-benchmark", item.role], statement: item.content.slice(0, 2000),
    evidence: [{ type: "artifact", ref: evidence.id, note: `Sanitized benchmark history unit ${item.id}` }], confidence: 0.5, stability: "low",
    created_at: date, updated_at: date, valid_from: date, review: { cadence_days: 1, next_review: date, change_condition: "Delete with the isolated benchmark case root." },
    status: "active", supersedes: [], superseded_by: [], vault_ref: null, memory_kind: item.role === "user" ? "instruction" : "event",
  };
  return { op_id: `benchmark_add_${digest.slice(0, 20)}`, op: "add", record, reason: "Diagnostic substrate ingestion from sanitized public benchmark history.", risk: "low", default_selected: false, supportingEvidence: [evidence], requiresStructuredEvidence: true };
}

export function createDiagnosticTrack(root: string, config: TrackConfig): BenchmarkTrackRunner {
  claimTrackRoot(root, "diagnostic"); const traces = new Map<string, TrackInsertTrace>();
  return {
    async insert(caseId: string, items: BenchmarkHistoryItem[]): Promise<TrackInsertTrace> {
      const now = config.now ?? items.at(-1)?.at ?? new Date().toISOString(); const ops = items.map((item) => diagnosticOperation(caseId, item));
      const patch: MemoryPatch = { patch_id: `patch_benchmark_${hash(`${caseId}:${ops.map((op) => op.op_id).join(":")}`).slice(0, 20)}`, created_at: now, generated_by: "manual", mode: "supervised", summary: `Diagnostic benchmark ingestion for ${caseId}`, ops, status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [] };
      const applied = applyPatch(root, patch, { now, selectedOpIds: ops.map((op) => op.op_id) });
      const trace: TrackInsertTrace = { caseId, track: "diagnostic", historyIds: items.map((item) => item.id), candidateIds: [], candidatesCreated: 0, proposedOperationIds: ops.map((op) => op.op_id), appliedOperationIds: applied.applied_ops, patchId: patch.patch_id };
      appendJsonlAtomic(join(root, "benchmark", "diagnostic-trace.jsonl"), trace); traces.set(caseId, trace); return trace;
    },
    async query(caseId: string, query: BenchmarkQuery): Promise<TrackQueryResult> { return retrieveBenchmarkContext(root, query, config, true, traces.get(caseId)?.candidateIds ?? []); },
    async close(caseId: string): Promise<void> { traces.delete(caseId); },
  };
}
