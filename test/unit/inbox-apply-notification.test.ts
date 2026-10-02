import { describe, expect, test } from "bun:test";
import { buildApplyReceiptNotification } from "../../src/lifecycle";
import type { MemoryPatch } from "../../src/types";

function receipt(overrides: Partial<MemoryPatch> = {}): MemoryPatch {
  return {
    patch_id: "patch_1",
    created_at: "2026-09-30T00:00:00Z",
    generated_by: "curator",
    mode: "auto",
    summary: "test",
    ops: [],
    status: "partially_applied",
    applied_at: "2026-09-30T00:00:01Z",
    applied_ops: ["op_1"],
    skipped_ops: [
      { op_id: "op_2", reason: "unresolved_evidence", detail: "review" },
      { op_id: "op_3", reason: "not_selected", detail: "not selected" },
    ],
    ...overrides,
  };
}

describe("startup inbox apply notification", () => {
  test("reports receipt-applied operations and only selected skips", () => {
    expect(buildApplyReceiptNotification(receipt(), ["op_1", "op_2"]))
      .toBe("✓ Applied 1 memory op(s); 1 skipped for review.");
  });

  test("does not claim attempted operations were applied", () => {
    expect(buildApplyReceiptNotification(receipt({ applied_ops: [] }), ["op_1", "op_2"]))
      .toBe("Applied 0 memory op(s); 1 skipped for review.");
  });
});
