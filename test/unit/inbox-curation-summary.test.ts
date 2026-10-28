import { describe, expect, test } from "bun:test";
import { summarizeInboxCuration, renderInboxCurationSummary } from "../../src/inbox-curation-summary";
import type { CaptureCandidate, MemoryPatch } from "../../src/types";

function candidate(id: string, confidence: number, evidence: number): CaptureCandidate {
  return {
    id, text: id, created_at: "2026-10-16T00:00:00Z",
    source: { type: "direct_user_instruction", ref: id },
    tags: [], evidence_refs: Array.from({ length: evidence }, (_, i) => `ev_${i}`),
    confidence, status: "new",
  };
}
function patch(): MemoryPatch {
  return {
    patch_id: "p1", created_at: "2026-10-16T00:00:00Z",
    generated_by: "curator", mode: "auto", summary: "test", ops: [],
    status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [],
  };
}
describe("inbox eligibility explanation", () => {
  test("explains empty batch when confidence and evidence gates hold candidates", () => {
    const summary = summarizeInboxCuration(
      [candidate("low", 0.4, 1), candidate("missing", 0.9, 0)],
      patch(), 0.75, 2, 0.85,
    );
    expect(summary.pending).toBe(2);
    expect(summary.safe_auto_ops).toBe(0);
    expect(summary.below_confidence).toBe(1);
    expect(summary.below_evidence).toBe(2);
    expect(renderInboxCurationSummary(summary)).toContain("no governance gate was bypassed");
  });
  test("reports candidate with no materialized op", () => {
    const summary = summarizeInboxCuration([candidate("existing", 0.92, 2)], patch(), 0.75, 2, 0.85);
    expect(summary.no_materialized_op).toBe(1);
  });
});
