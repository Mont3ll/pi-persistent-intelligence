import { describe, expect, test } from "bun:test";
import { extractHardRules, formatHardRule, renderHardRulesBlock } from "../../src/rules";
import type { MemoryRecord } from "../../src/types";

function record(id: string, ruleType: string, confidence: number, statement: string): MemoryRecord {
  return {
    id, layer: "L2", scope: { type: "global" }, tags: [ruleType],
    statement, evidence: [{ type: "manual", ref: "d", note: "n" }],
    confidence, stability: "semi-stable",
    created_at: "2026-05-12", updated_at: "2026-05-12",
    review: { cadence_days: 30, next_review: "2026-06-12", change_condition: "If contradicted." },
    status: "active", supersedes: [], superseded_by: [], vault_ref: null,
    ruleType: ruleType as any,
  };
}

describe("extractHardRules", () => {
  test("returns high-confidence typed correction records", () => {
    const records = [
      record("r1", "avoid_pattern", 0.92, "Never edit MEMORY.md directly"),
      record("r2", "prefer_pattern", 0.88, "Use bun not npm"),
      record("r3", "workflow", 0.95, "Run typecheck before committing"), // high conf but workflow type
      record("r4", "correction", 0.91, "Always tag decisions with #decision"),
    ];
    const rules = extractHardRules(records);
    expect(rules.some((r) => r.id === "r1")).toBe(true);
    expect(rules.some((r) => r.id === "r2")).toBe(true);
    expect(rules.some((r) => r.id === "r4")).toBe(true);
    // workflow type is not a hard rule type
    expect(rules.some((r) => r.id === "r3")).toBe(false);
  });

  test("excludes low-confidence records", () => {
    const records = [record("r_low", "avoid_pattern", 0.70, "Avoid X")];
    expect(extractHardRules(records)).toHaveLength(0);
  });

  test("excludes deprecated records", () => {
    const rec = { ...record("r_dep", "avoid_pattern", 0.90, "Avoid Y"), status: "deprecated" as const };
    expect(extractHardRules([rec])).toHaveLength(0);
  });

  test("caps at MAX_HARD_RULES (8)", () => {
    const records = Array.from({ length: 12 }, (_, i) => record(`r${i}`, "avoid_pattern", 0.90, `Rule ${i}`));
    expect(extractHardRules(records).length).toBeLessThanOrEqual(8);
  });
});

describe("formatHardRule", () => {
  test("uses correct prefix per ruleType", () => {
    expect(formatHardRule(record("r1", "avoid_pattern", 0.9, "Avoid X"))).toContain("⚠️");
    expect(formatHardRule(record("r2", "prefer_pattern", 0.9, "Prefer Y"))).toContain("✓");
    expect(formatHardRule(record("r3", "convention", 0.9, "Use Z"))).toContain("📌");
    expect(formatHardRule(record("r4", "correction", 0.9, "Always A"))).toContain("📌");
  });
});

describe("renderHardRulesBlock", () => {
  test("returns empty string when no hard rules", () => {
    expect(renderHardRulesBlock([])).toBe("");
  });

  test("returns block with hard rules", () => {
    const records = [record("r1", "avoid_pattern", 0.92, "Never edit MEMORY.md")];
    const block = renderHardRulesBlock(records);
    expect(block).toContain("Never edit MEMORY.md");
  });
});
