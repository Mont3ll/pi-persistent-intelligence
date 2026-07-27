import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { PatchReviewPanel } from "../../src/tui/PatchReviewPanel";
import type { MemoryPatch } from "../../src/types";

const patch: MemoryPatch = {
  patch_id: "patch_test",
  created_at: "2026-05-08T00:00:00Z",
  generated_by: "curator",
  mode: "propose",
  summary: "Test patch",
  ops: [
    { op_id: "op_001", op: "add", risk: "low", default_selected: true, rationale: "safe add" },
    { op_id: "op_002", op: "deprecate", risk: "high", default_selected: false, rationale: "danger" },
  ],
  status: "proposed",
  applied_at: null,
  applied_ops: [],
  skipped_ops: [],
};

describe("PatchReviewPanel", () => {
  test("renders selected count and patch operations", () => {
    const panel = new PatchReviewPanel(patch, () => {});
    const output = panel.render(100).join("\n");
    expect(output).toContain("patch_test");
    expect(output).toContain("1 selected");
    expect(output).toContain("op_001");
    expect(output).toContain("op_002");
  });

  test("uses the unified layout without decorative separators or width overflow", () => {
    const panel = new PatchReviewPanel(patch, () => {});
    const lines = panel.render(36);
    const plain = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
    const text = lines.join("\n");
    expect(text).toContain("Memory Curator");
    expect(text).toContain("↑↓ move");
    expect(plain.some((line) => /^─+$/.test(line))).toBe(false);
    expect(lines.every((line) => visibleWidth(line) <= 36)).toBe(true);
  });

  test("toggles highlighted operation with space", () => {
    const panel = new PatchReviewPanel(patch, () => {});
    expect(panel.getSelectedOpIds()).toEqual(["op_001"]);
    panel.handleInput?.(" ");
    expect(panel.getSelectedOpIds()).toEqual([]);
  });

  test("cancels review with q, ctrl+c, or escape", () => {
    for (const key of ["q", "\u0003", "\u001b"]) {
      let result: string[] | null | undefined;
      const panel = new PatchReviewPanel(patch, (selected) => { result = selected; });
      panel.handleInput?.(key);
      expect(result).toBeNull();
    }
  });
});
