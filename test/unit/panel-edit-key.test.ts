import { describe, expect, test } from "bun:test";
import { PatchReviewPanel } from "../../src/tui/PatchReviewPanel";
import type { MemoryPatch, MemoryRecord } from "../../src/types";

function record(statement: string): MemoryRecord {
  return { id: "mem_1", layer: "L2", scope: { type: "global" }, tags: ["workflow"], statement, evidence: [{ type: "manual", ref: "x", note: "n" }], confidence: 0.8, stability: "semi-stable", created_at: "2026-05-09", updated_at: "2026-05-09", review: { cadence_days: 30, next_review: "2026-06-08", change_condition: "If contradicted, revise." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null };
}

function patch(): MemoryPatch {
  return { patch_id: "patch_edit", created_at: "2026-05-09T00:00:00Z", generated_by: "curator", mode: "propose", summary: "edit", ops: [{ op_id: "op_001", op: "add", record: record("Original statement"), risk: "low", default_selected: true }], status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [] };
}

describe("PatchReviewPanel edit key", () => {
  test("pressing e delegates to edit callback", () => {
    const p = patch();
    const panel = new PatchReviewPanel(p, () => {}, (current) => `${current} edited`);
    panel.handleInput?.("e");
    expect(p.ops[0].record?.statement).toBe("Original statement edited");
  });
});
