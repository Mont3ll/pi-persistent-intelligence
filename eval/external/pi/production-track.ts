import { join } from "node:path";
import { processCaptureTurn } from "../../../src/capture-coordinator";
import { curateInbox } from "../../../src/curator";
import { listCandidates } from "../../../src/inbox";
import { applyPatch } from "../../../src/patch";
import { appendJsonlAtomic } from "../core/artifacts";
import type { BenchmarkHistoryItem, BenchmarkQuery, TrackConfig } from "../core/protocol";
import { retrieveBenchmarkContext } from "./retrieval";
import { claimTrackRoot } from "./track-root";
import type { BenchmarkTrackRunner, TrackInsertTrace, TrackQueryResult } from "./types";

export function createProductionTrack(root: string, config: TrackConfig): BenchmarkTrackRunner {
  claimTrackRoot(root, "production");
  const traces = new Map<string, TrackInsertTrace>();
  return {
    async insert(caseId: string, items: BenchmarkHistoryItem[]): Promise<TrackInsertTrace> {
      const before = new Set(listCandidates(root).map((item) => item.id)); let candidatesCreated = 0;
      for (const item of items) {
        if (item.role === "user") {
          const result = processCaptureTurn(root, {
            session_id: `benchmark:${caseId}`, turn_id: item.id, message: item.content, launch_cwd: root, actions: [], now: item.at,
            resolver: () => ({ project_id: `benchmark-${caseId}`, source: "explicit_config", display_name: "isolated benchmark case" }),
          });
          candidatesCreated += result.candidates_created;
        } else {
          appendJsonlAtomic(join(root, "benchmark", "session-evidence.jsonl"), { id: item.id, role: item.role, at: item.at, content: item.content.slice(0, 4000) });
        }
      }
      const now = config.now ?? items.at(-1)?.at ?? new Date().toISOString();
      const proposed = curateInbox(root, { now, mode: "auto", minEvidenceCount: 1, governanceMode: "compatibility" });
      const selectedOpIds = proposed.ops.filter((op) => op.default_selected && op.risk !== "high").map((op) => op.op_id);
      const applied = applyPatch(root, proposed, { now, selectedOpIds });
      const candidateIds = listCandidates(root).map((item) => item.id).filter((id) => !before.has(id));
      const trace: TrackInsertTrace = { caseId, track: "production", historyIds: items.map((item) => item.id), candidateIds, candidatesCreated, proposedOperationIds: proposed.ops.map((op) => op.op_id), appliedOperationIds: applied.applied_ops, patchId: proposed.patch_id };
      appendJsonlAtomic(join(root, "benchmark", "production-trace.jsonl"), trace); traces.set(caseId, trace); return trace;
    },
    async query(caseId: string, query: BenchmarkQuery): Promise<TrackQueryResult> { return retrieveBenchmarkContext(root, query, config, false, traces.get(caseId)?.candidateIds ?? []); },
    async close(caseId: string): Promise<void> { traces.delete(caseId); },
  };
}
