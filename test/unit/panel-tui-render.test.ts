import { describe, expect, test } from "bun:test";
import { createPatchReviewComponent } from "../../src/tui/PatchReviewPanel";
import type { MemoryPatch } from "../../src/types";

const patch: MemoryPatch = {
  patch_id: "patch_render",
  created_at: "2026-05-09T00:00:00Z",
  generated_by: "curator",
  mode: "propose",
  summary: "render",
  ops: [
    { op_id: "op_001", op: "add", risk: "low", default_selected: true, rationale: "safe" },
    { op_id: "op_002", op: "add", risk: "low", default_selected: false, rationale: "safe" },
  ],
  status: "proposed",
  applied_at: null,
  applied_ops: [],
  skipped_ops: [],
};

describe("createPatchReviewComponent", () => {
  test("requests a TUI re-render after keyboard input", () => {
    let renders = 0;
    const component = createPatchReviewComponent(patch, () => {}, { requestRender: () => renders++ });

    component.handleInput?.("\u001b[B");
    component.handleInput?.(" ");

    expect(renders).toBe(2);
    expect(component.render(100).join("\n")).toContain("2 selected");
  });
});
