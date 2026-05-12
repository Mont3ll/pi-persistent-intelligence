import { describe, expect, test } from "bun:test";
import { isMemoryRecord } from "../../src/types";

const validRecord = {
  id: "mem_20260508_001",
  layer: "L2",
  scope: { type: "global" },
  tags: ["workflow"],
  statement: "Use canonical JSONL as the governed store and render markdown for humans.",
  evidence: [{ type: "artifact", ref: "README.md", note: "Design documented" }],
  confidence: 0.9,
  stability: "semi-stable",
  created_at: "2026-05-08",
  updated_at: "2026-05-08",
  review: { cadence_days: 30, next_review: "2026-06-07", change_condition: "If JSONL proves too complex, revisit." },
  status: "active",
  supersedes: [],
  superseded_by: [],
  vault_ref: null,
};

describe("isMemoryRecord", () => {
  test("accepts a valid governed memory record", () => {
    expect(isMemoryRecord(validRecord)).toBe(true);
  });

  test("rejects a record without evidence", () => {
    const record = { ...validRecord, evidence: [] };
    expect(isMemoryRecord(record)).toBe(false);
  });

  test("rejects a record without a change condition", () => {
    const record = { ...validRecord, review: { cadence_days: 30, next_review: "2026-06-07" } };
    expect(isMemoryRecord(record)).toBe(false);
  });
});
