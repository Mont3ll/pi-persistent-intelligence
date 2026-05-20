import type { MemoryRecord } from "./types";

const CONTESTED_INJECTION_CAP = 2;

function tokenOverlap(text1: string, text2: string): number {
  const tokens1 = new Set(text1.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const tokens2 = new Set(text2.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  if (tokens1.size === 0 || tokens2.size === 0) return 0;
  const matches = [...tokens1].filter((t) => tokens2.has(t)).length;
  return matches / Math.min(tokens1.size, tokens2.size);
}

/**
 * Select context-relevant contested records for warning injection.
 * Only contested records with content overlap to the current prompt are surfaced.
 * Capped at CONTESTED_INJECTION_CAP (2).
 */
export function extractContestedMemory(records: MemoryRecord[], prompt: string): MemoryRecord[] {
  return records
    .filter((r) => r.status === "contested")
    .map((r) => ({ record: r, score: tokenOverlap(`${r.statement} ${r.tags.join(" ")}`, prompt) }))
    .filter((item) => item.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, CONTESTED_INJECTION_CAP)
    .map((item) => item.record);
}

/**
 * Render a contested-memory section with warning language.
 * Only included when non-empty; never part of hard rules.
 */
export function renderContestedMemoryBlock(records: MemoryRecord[], _prompt: string): string {
  if (records.length === 0) return "";
  const lines = records.map((r) => `⚠️ CONTESTED: [${r.id}, conf ${r.confidence.toFixed(2)}] ${r.statement}`);
  return [
    "## Contested Memory",
    "<!-- ⚠️ These records have open conflicts. Review before relying on them. -->",
    ...lines,
    "",
  ].join("\n");
}
