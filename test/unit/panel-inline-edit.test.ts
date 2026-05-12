import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { PatchReviewPanel } from "../../src/tui/PatchReviewPanel";
import type { MemoryPatch, MemoryRecord } from "../../src/types";

function record(statement: string): MemoryRecord {
  return { id: "mem_1", layer: "L2", scope: { type: "global" }, tags: ["workflow"], statement, evidence: [{ type: "manual", ref: "x", note: "n" }], confidence: 0.8, stability: "semi-stable", created_at: "2026-05-09", updated_at: "2026-05-09", review: { cadence_days: 30, next_review: "2026-06-08", change_condition: "If contradicted, revise." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null };
}

function patch(): MemoryPatch {
  return { patch_id: "patch_edit", created_at: "2026-05-09T00:00:00Z", generated_by: "curator", mode: "propose", summary: "edit", ops: [{ op_id: "op_001", op: "add", record: record("Original statement"), risk: "low", default_selected: true }], status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [] };
}

describe("PatchReviewPanel inline edit mode", () => {
  test("edits the highlighted statement without an external prompt", () => {
    const p = patch();
    const panel = new PatchReviewPanel(p, () => {});
    panel.handleInput?.("e");
    expect(panel.render(100).join("\n")).toContain("EDITING");
    panel.handleInput?.("\u0015");
    for (const ch of "Inline edited statement") panel.handleInput?.(ch);
    panel.handleInput?.("\r");
    expect(p.ops[0].record?.statement).toBe("Inline edited statement");
  });

  test("wraps a long edit buffer and renders a visible cursor marker", () => {
    const p = patch();
    const panel = new PatchReviewPanel(p, () => {});
    panel.focused = true;
    panel.handleInput?.("e");
    panel.handleInput?.("\u0015");
    for (const ch of "This is a deliberately long edit buffer that should wrap instead of disappearing off the screen") panel.handleInput?.(ch);
    const lines = panel.render(42);
    expect(lines.some((line) => line.includes("Edit buffer"))).toBe(true);
    expect(lines.some((line) => line.includes("\x1b[7m"))).toBe(true);
    expect(lines.every((line) => visibleWidth(line) <= 42)).toBe(true);
  });

  test("supports cursor movement and insertion inside the edit buffer", () => {
    const p = patch();
    const panel = new PatchReviewPanel(p, () => {});
    panel.handleInput?.("e");
    panel.handleInput?.("\u0015");
    for (const ch of "helo") panel.handleInput?.(ch);
    panel.handleInput?.("\u001b[D");
    panel.handleInput?.("l");
    panel.handleInput?.("\r");
    expect(p.ops[0].record?.statement).toBe("hello");
  });
});
