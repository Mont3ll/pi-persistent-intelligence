import { describe, expect, test } from "bun:test";
import { selectInboxBatchApplyOpIds } from "../../src/curation-selection";
import type { MemoryPatch, PatchOp } from "../../src/types";

function patch(ops: PatchOp[]): MemoryPatch {
  return {
    patch_id: "patch_test",
    created_at: "2026-10-03T00:00:00Z",
    generated_by: "curator",
    mode: "auto",
    summary: "test",
    ops,
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}

function addOp(id: string, confidence: number, defaultSelected: boolean, risk: "low" | "high" = "low"): PatchOp {
  return {
    op_id: id,
    candidate_id: `cap_${id}`,
    op: "add",
    target: "memory/L2.playbooks.jsonl",
    record: {
      id: `mem_${id}`,
      layer: "L2",
      scope: { type: "global" },
      tags: [],
      statement: id,
      evidence: [],
      confidence,
      stability: "semi-stable",
      created_at: "2026-10-03",
      updated_at: "2026-10-03",
      review: { cadence_days: 30, next_review: "2026-11-02", change_condition: "review" },
      status: "active",
      supersedes: [],
      superseded_by: [],
      vault_ref: null,
    },
    rationale: "test",
    risk,
    default_selected: defaultSelected,
    supportingEvidence: [],
    requiresStructuredEvidence: false,
  };
}

describe("inbox batch apply selection", () => {
  test("selects only default-selected, non-high-risk operations above threshold", () => {
    const result = selectInboxBatchApplyOpIds(patch([
      addOp("safe", 0.9, true),
      addOp("review_only", 0.95, false),
      addOp("high_risk", 0.95, true, "high"),
      addOp("low_confidence", 0.8, true),
    ]), 0.85);

    expect(result).toEqual(["safe"]);
  });
});
