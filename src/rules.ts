/**
 * Hard rule extraction and formatting.
 *
 * Compatibility mode preserves the legacy high-confidence typed-rule path.
 * Strict mode requires explicit, provenance-backed policy ratification. Confidence
 * can rank beliefs, but it cannot create directive authority.
 */

import { hasDirectiveAuthority } from "./policy-authority";
import type { GovernanceMode, MemoryRecord, MemoryRuleType } from "./types";

const HARD_RULE_TYPES: MemoryRuleType[] = ["avoid_pattern", "prefer_pattern", "correction", "convention"];
const HARD_RULE_MIN_CONFIDENCE = 0.85;
const MAX_HARD_RULES = 8;

function isActionableRule(record: MemoryRecord): boolean {
  return record.status === "active" &&
    record.layer === "L2" &&
    record.ruleType !== undefined &&
    HARD_RULE_TYPES.includes(record.ruleType);
}

export function extractHardRules(records: MemoryRecord[], mode: GovernanceMode = "compatibility"): MemoryRecord[] {
  return records
    .filter((record) => {
      if (!isActionableRule(record)) return false;
      if (!hasDirectiveAuthority(record, mode)) return false;
      return mode === "strict" || record.confidence >= HARD_RULE_MIN_CONFIDENCE;
    })
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

export function renderHardRulesBlockWithCount(records: MemoryRecord[], mode: GovernanceMode = "compatibility"): RenderedHardRulesBlock {
  const rules = extractHardRules(records, mode);
  if (rules.length === 0) return { block: "", count: 0 };
  return { block: ["## Hard Rules", rules.map(formatHardRule).join("\n"), ""].join("\n"), count: rules.length };
}

export function renderHardRulesBlock(records: MemoryRecord[], mode: GovernanceMode = "compatibility"): string {
  return renderHardRulesBlockWithCount(records, mode).block;
}
