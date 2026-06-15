/**
 * Hard rule extraction and formatting.
 *
 * Hard rules are high-confidence, typed correction memories that deserve
 * prominent injection — similar to pi-code-intelligence's machine-checkable rules.
 *
 * Rules are injected with a strong prefix (⚠️ AVOID / ✓ PREFER / 📌 RULE)
 * to distinguish them from soft preferences in the context block.
 *
 * A memory record qualifies as a hard rule when:
 * - confidence ≥ 0.85 (high confidence)
 * - ruleType is an actionable correction type
 * - status is "active"
 * - layer is L2 (identity L1 rules are always injected separately)
 */

import type { MemoryRecord, MemoryRuleType } from "./types";

const HARD_RULE_TYPES: MemoryRuleType[] = ["avoid_pattern", "prefer_pattern", "correction", "convention"];
const HARD_RULE_MIN_CONFIDENCE = 0.85;
const MAX_HARD_RULES = 8;

export function extractHardRules(records: MemoryRecord[]): MemoryRecord[] {
  return records
    .filter(
      (r) =>
        r.status === "active" &&
        r.confidence >= HARD_RULE_MIN_CONFIDENCE &&
        r.layer === "L2" &&
        r.ruleType !== undefined &&
        HARD_RULE_TYPES.includes(r.ruleType),
    )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_HARD_RULES);
}

export function formatHardRule(record: MemoryRecord): string {
  const prefix =
    record.ruleType === "avoid_pattern" ? "⚠️  AVOID:" :
    record.ruleType === "prefer_pattern" ? "✓  PREFER:" :
    record.ruleType === "convention"      ? "📌 CONVENTION:" :
    "📌 RULE:";
  const conf = record.confidence.toFixed(2);
  return `${prefix} [conf ${conf}] ${record.statement}`;
}

export interface RenderedHardRulesBlock {
  block: string;
  count: number;
}

export function renderHardRulesBlockWithCount(records: MemoryRecord[]): RenderedHardRulesBlock {
  const rules = extractHardRules(records);
  if (rules.length === 0) return { block: "", count: 0 };
  return { block: ["## Hard Rules", rules.map(formatHardRule).join("\n"), ""].join("\n"), count: rules.length };
}

export function renderHardRulesBlock(records: MemoryRecord[]): string {
  return renderHardRulesBlockWithCount(records).block;
}
