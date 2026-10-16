import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { PatchReviewPanel } from "../../src/tui/PatchReviewPanel";
import type { MemoryPatch, PatchOp } from "../../src/types";

function patch(total: number): MemoryPatch {
  const ops: PatchOp[] = Array.from({ length: total }, (_, i) => ({
    op_id: `op_${String(i + 1).padStart(3, "0")}`,
    op: "add",
    risk: i % 3 === 0 ? "high" : "low",
    default_selected: false,
    rationale: "A very long reason ".repeat(35),
    record: {
      id: `mem_${i}`, layer: "L2", scope: { type: "global" },
      tags: ["test"], statement: "A deliberately long statement ".repeat(40),
      evidence: [{ type: "manual", ref: "fixture", note: "unit" }],
      confidence: 0.7, stability: "semi-stable", created_at: "2026-10-16",
      updated_at: "2026-10-16", review: { cadence_days: 30, next_review: "2026-11-15", change_condition: "review" },
      status: "active", supersedes: [], superseded_by: [], vault_ref: null,
    },
  }));
  return {
    patch_id: "patch_pagination", created_at: "2026-10-16T00:00:00Z",
    generated_by: "curator", mode: "propose", summary: "pagination fixture",
    ops, status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [],
  };
}

describe("PatchReviewPanel bounded navigation", () => {
  test("renders a bounded page instead of all candidates", () => {
    const panel = new PatchReviewPanel(patch(23), () => {});
    const lines = panel.render(60);
    const output = lines.join("\n");
    expect(output).toContain("Page 1/5");
    expect(output).toContain("op_001");
    expect(output).toContain("op_005");
    expect(output).not.toContain("op_006");
    expect(output).not.toContain("op_023");
    expect(lines.length).toBeLessThan(30);
    expect(lines.every((line) => visibleWidth(line) <= 60)).toBe(true);
  });

  test("cursor movement, page navigation and Home/End reach offscreen entries", () => {
    const panel = new PatchReviewPanel(patch(23), () => {});
    for (let i = 0; i < 8; i++) panel.handleInput?.("\u001b[B");
    const middle = panel.render(80).join("\n");
    expect(middle).toContain("Page 2/5");
    expect(middle).toContain("op_009");

    panel.handleInput?.(" ");
    expect(panel.getSelectedOpIds()).toContain("op_009");
    panel.handleInput?.("\u001b[6~");
    expect(panel.render(80).join("\n")).toContain("Page 3/5");
    panel.handleInput?.("\u001b[F");
    expect(panel.render(80).join("\n")).toContain("op_023");
    panel.handleInput?.(" ");
    expect(panel.getSelectedOpIds()).toContain("op_023");
    expect(panel.getSelectedOpIds()).toContain("op_009");
    panel.handleInput?.("\u001b[H");
    expect(panel.render(80).join("\n")).toContain("Page 1/5");
  });

  test("does not auto-select high-risk operations when paging", () => {
    const panel = new PatchReviewPanel(patch(12), () => {});
    panel.handleInput?.("\u001b[6~");
    expect(panel.getSelectedOpIds()).toEqual([]);
  });
});
