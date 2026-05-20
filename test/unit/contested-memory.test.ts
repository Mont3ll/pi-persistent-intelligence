import { describe, expect, test } from "bun:test";
import { extractContestedMemory, renderContestedMemoryBlock } from "../../src/contested-memory";
import type { MemoryRecord } from "../../src/types";

function record(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["testing"],
    statement: `${id} use bun for tests.`,
    evidence: [{ type: "manual", ref: "x", note: "n" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-05-20",
    updated_at: "2026-05-20",
    review: { cadence_days: 30, next_review: "2026-06-20", change_condition: "c" },
    status: "contested",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...overrides,
  };
}

describe("contested memory injection", () => {
  test("returns empty block when no contested records", () => {
    const block = renderContestedMemoryBlock([], "run bun tests");
    expect(block).toBe("");
  });

  test("contested record not present under hard rules candidates", () => {
    const { extractHardRules } = require("../../src/rules");
    const contested = record("mem_contested", { ruleType: "avoid_pattern", confidence: 0.95 });
    const hardRules = extractHardRules([contested]);
    expect(hardRules).toHaveLength(0);
  });

  test("renders contested records with warning language", () => {
    const records = [record("mem_c1", { status: "contested" }), record("mem_c2", { status: "contested" })];
    const relevant = extractContestedMemory(records, "bun test workflow");
    const block = renderContestedMemoryBlock(relevant, "bun test workflow");
    expect(block).toContain("## Contested Memory");
    expect(block).toContain("⚠️");
    expect(block).toContain("Review before relying");
    expect(relevant.length).toBeLessThanOrEqual(2);
  });

  test("caps contested injection at 2 records", () => {
    const many = Array.from({ length: 5 }, (_, i) => record(`mem_c${i}`, { tags: ["bun", "testing"] }));
    const relevant = extractContestedMemory(many, "bun test");
    expect(relevant.length).toBeLessThanOrEqual(2);
  });

  test("only includes context-relevant contested records", () => {
    const relevant = record("mem_relevant", { tags: ["bun", "testing"], statement: "Use bun for testing." });
    const irrelevant = record("mem_irrelevant", { tags: ["graphics"], statement: "OpenGL rendering." });
    const result = extractContestedMemory([relevant, irrelevant], "run bun tests");
    expect(result.some((r) => r.id === "mem_relevant")).toBe(true);
    expect(result.some((r) => r.id === "mem_irrelevant")).toBe(false);
  });
});
