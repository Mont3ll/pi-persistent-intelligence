import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadActiveRecords } from "./store";
import { ensureMemoryDirs } from "./paths";
import { listScratchpadItems } from "./scratchpad";
import { readDailyLog } from "./daily";
import { runQmd, qmdSearchArgs } from "./qmd";
import { shouldInjectMemoryContext } from "./injection-filter";
import { renderHardRulesBlock } from "./rules";
import { MemoryFtsIndex } from "./search/fts";
import { mergeHybridResults, parseQmdMemoryIds } from "./search/hybrid";
import type { MemoryRecord } from "./types";

export interface RetrievalOptions {
  prompt: string;
  today: string;
  maxDailyChars?: number;
  maxRecords?: number;
  maxTotalChars?: number;
  useQmd?: boolean;
  qmdCollection?: string;
  ftsIndex?: MemoryFtsIndex;
}

export interface RetrievalContext {
  markdown: string;
  selectedMemory: MemoryRecord[];
}

// ─── Staleness helpers ────────────────────────────────────────────────────────

function daysSince(dateStr: string): number {
  try {
    const then = new Date(dateStr).getTime();
    return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  } catch { return 0; }
}

function stalenessTag(record: MemoryRecord): string {
  const days = daysSince(record.updated_at);
  if (days >= 90) return ` 🔴 ${days}d`;
  if (days >= 30) return ` ⚠️ ${days}d`;
  return "";
}

function renderRecordBrief(record: MemoryRecord): string {
  const stale = stalenessTag(record);
  const ruleTag = record.ruleType ? ` [${record.ruleType}]` : "";
  return `- ${record.id} [${record.layer}, conf ${record.confidence.toFixed(2)}${stale}${ruleTag}] ${record.statement}`;
}

// ─── Relevance selection ─────────────────────────────────────────────────────

function promptTerms(prompt: string): Set<string> {
  return new Set(prompt.toLowerCase().split(/[^a-z0-9-]+/).filter((t) => t.length > 2));
}

function isRelevantByTerms(record: MemoryRecord, terms: Set<string>): boolean {
  if (record.layer === "L1") return true;
  const haystack = `${record.tags.join(" ")} ${record.statement} ${record.ruleType ?? ""}`.toLowerCase();
  return [...terms].some((t) => haystack.includes(t));
}

/** Parse qmd JSON to extract record IDs */
function parseQmdIds(stdout: string): string[] {
  return parseQmdMemoryIds(stdout);
}

/**
 * Select relevant L2 records using hybrid FTS + qmd semantic search.
 * Falls back through: hybrid → FTS-only → term-matching.
 */
async function selectMemoryHybrid(
  root: string,
  prompt: string,
  maxRecords: number,
  ftsIndex?: MemoryFtsIndex,
  useQmd?: boolean,
  qmdCollection?: string,
): Promise<MemoryRecord[]> {
  const allRecords = loadActiveRecords(root);
  const l1 = allRecords.filter((r) => r.layer === "L1");
  const l2 = allRecords.filter((r) => r.layer === "L2");

  // Try hybrid (FTS + qmd semantic)
  if (ftsIndex?.isAvailable) {
    const ftsResults = ftsIndex.search(prompt, maxRecords * 2);
    let semanticIds: string[] = [];

    if (useQmd && qmdCollection) {
      try {
        const result = await runQmd(qmdSearchArgs(prompt, "semantic", maxRecords, qmdCollection), 5_000);
        semanticIds = parseQmdIds(result.stdout);
      } catch { /* qmd unavailable — use FTS only */ }
    }

    const recordMap = new Map(
      l2.map((r) => [r.id, { statement: r.statement, layer: r.layer as "L1" | "L2", confidence: r.confidence, ruleType: r.ruleType }]),
    );

    const merged = mergeHybridResults(ftsResults, semanticIds, recordMap, maxRecords);
    const selectedL2 = merged.flatMap((h) => {
      const rec = l2.find((r) => r.id === h.id);
      return rec ? [rec] : [];
    });

    return [...l1, ...selectedL2].slice(0, maxRecords);
  }

  // FTS-only fallback
  if (ftsIndex?.isAvailable) {
    const ftsResults = ftsIndex.search(prompt, maxRecords);
    const ftsIds = new Set(ftsResults.map((r) => r.id));
    const selectedL2 = l2.filter((r) => ftsIds.has(r.id)).slice(0, maxRecords - l1.length);
    return [...l1, ...selectedL2];
  }

  // Term-matching fallback (original approach)
  const terms = promptTerms(prompt);
  return allRecords.filter((r) => isRelevantByTerms(r, terms)).slice(0, maxRecords);
}

// ─── Daily digest ─────────────────────────────────────────────────────────────

export function buildDailyDigest(dailyContent: string, maxChars: number): string {
  if (!dailyContent.trim()) return "";

  const sessionCount = (dailyContent.match(/## Session ended/g) ?? []).length;

  const notableLines: string[] = [];
  for (const line of dailyContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("<!-- ") || trimmed === "## Session ended" || trimmed.startsWith("- Persistent Intelligence")) continue;
    if (trimmed.startsWith("## ") || trimmed.includes("#decision") || trimmed.includes("#key") || trimmed.startsWith("- ")) {
      notableLines.push(trimmed);
    }
  }

  const header = sessionCount > 0 ? `Sessions today: ${sessionCount}\n` : "";

  if (notableLines.length > 0) {
    const body = notableLines.join("\n");
    const digest = `${header}${body}`;
    return digest.length > maxChars ? digest.slice(0, maxChars - 20) + "\n... (truncated)" : digest;
  }

  if (header) return header.trim();
  return dailyContent.slice(-maxChars);
}

// ─── Dynamic budget assembler ─────────────────────────────────────────────────

function assembleWithBudget(sections: Array<{ label: string; content: string }>, maxTotal: number): string {
  const parts: string[] = [];
  let used = 0;

  for (const { label, content } of sections) {
    if (!content.trim()) {
      parts.push(label, "_empty_", "");
      continue;
    }
    const remaining = maxTotal - used;
    if (remaining <= 50) break;
    const capped = content.length > remaining ? content.slice(0, remaining - 20) + "\n... (truncated)" : content;
    parts.push(label, capped, "");
    used += capped.length + label.length;
  }

  return parts.join("\n");
}

// ─── Main retrieval function ─────────────────────────────────────────────────

export async function buildRetrievalContext(root: string, options: RetrievalOptions): Promise<RetrievalContext> {
  // Skip injection for trivial prompts — saves tokens and avoids noise
  if (!shouldInjectMemoryContext(options.prompt)) {
    return { markdown: "", selectedMemory: [] };
  }

  const paths = ensureMemoryDirs(root);
  const maxTotal = options.maxTotalChars ?? 14_000;
  const maxRecords = options.maxRecords ?? 12;

  const selectedMemory = await selectMemoryHybrid(
    root,
    options.prompt,
    maxRecords,
    options.ftsIndex,
    options.useQmd,
    options.qmdCollection,
  );

  const scratchpadItems = listScratchpadItems(root).filter((item) => !item.done);
  const daily = readDailyLog(root, options.today);
  const dailyDigest = buildDailyDigest(daily, options.maxDailyChars ?? 3000);

  // Hard rules: high-confidence typed corrections injected prominently
  const allRecords = loadActiveRecords(root);
  const hardRulesBlock = renderHardRulesBlock(allRecords);

  const header = "# Persistent Intelligence Context";

  const content = assembleWithBudget([
    {
      label: "## Hard Rules",
      content: hardRulesBlock.replace("## Hard Rules\n", "").trim(),
    },
    {
      label: "## Selected Memory",
      content: selectedMemory.length
        ? selectedMemory.map(renderRecordBrief).join("\n")
        : "_No selected long-term memory._",
    },
    {
      label: "## Scratchpad",
      content: scratchpadItems.length
        ? scratchpadItems.map((item) => `- [ ] ${item.text}`).join("\n")
        : "_No open scratchpad items._",
    },
    {
      label: `## Daily Log (${options.today})`,
      content: dailyDigest || "_No daily log content._",
    },
  ], maxTotal - header.length);

  const markdown = `${header}\n\n${content}`;
  writeFileSync(paths.runtime.context, markdown, "utf-8");
  writeFileSync(paths.runtime.selected, `${JSON.stringify(selectedMemory, null, 2)}\n`, "utf-8");
  return { markdown, selectedMemory };
}

export function readRuntimeContext(root: string): string {
  const paths = ensureMemoryDirs(root);
  return existsSync(paths.runtime.context) ? readFileSync(paths.runtime.context, "utf-8") : "";
}

/**
 * Suggest vault_ref values from vault concept/entity pages matching candidate tags.
 */
export function suggestVaultRefs(tags: string[], vaultPath?: string): string[] {
  const vaultDir = vaultPath ?? process.env.PI_VAULT_PATH;
  if (!vaultDir) return [];
  const candidates: string[] = [];
  for (const subdir of ["6. Zettelkasten/Concepts", "6. Zettelkasten/Entities"]) {
    const dir = join(vaultDir, subdir);
    if (!existsSync(dir)) continue;
    try {
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
        const title = file.replace(/\.md$/, "").toLowerCase();
        if (tags.some((tag) => title.includes(tag.toLowerCase()) || tag.toLowerCase().includes(title.split(" ")[0]))) {
          candidates.push(file.replace(/\.md$/, ""));
        }
      }
    } catch { /* ignore */ }
  }
  return [...new Set(candidates)].slice(0, 3);
}

/**
 * Sync the FTS index with current active records.
 * Call after any canonical mutation (applyPatch, session_start).
 */
export function syncFtsIndex(root: string, ftsIndex: MemoryFtsIndex): void {
  const records = loadActiveRecords(root);
  ftsIndex.sync(
    records.map((r) => ({
      id: r.id,
      layer: r.layer,
      ruleType: r.ruleType,
      confidence: r.confidence,
      statement: r.statement,
      tags: r.tags,
    })),
  );
}
