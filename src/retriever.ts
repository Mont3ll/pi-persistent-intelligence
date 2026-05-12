import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadActiveRecords } from "./store";
import { ensureMemoryDirs } from "./paths";
import { listScratchpadItems } from "./scratchpad";
import { readDailyLog } from "./daily";
import { runQmd, qmdSearchArgs } from "./qmd";
import type { MemoryRecord } from "./types";

export interface RetrievalOptions {
  prompt: string;
  today: string;
  maxDailyChars?: number;
  maxRecords?: number;
  maxTotalChars?: number;      // dynamic budget cap (default 14_000)
  useQmd?: boolean;            // use qmd semantic search for L2 selection
  qmdCollection?: string;
}

export interface RetrievalContext {
  markdown: string;
  selectedMemory: MemoryRecord[];
}

// ─── Staleness helpers ────────────────────────────────────────────────

function daysSince(dateStr: string): number {
  try {
    const then = new Date(dateStr).getTime();
    return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  } catch {
    return 0;
  }
}

function stalenessTag(record: MemoryRecord): string {
  const days = daysSince(record.updated_at);
  if (days >= 90) return ` 🔴 ${days}d`;
  if (days >= 30) return ` ⚠️ ${days}d`;
  return "";
}

function renderRecordBrief(record: MemoryRecord): string {
  const stale = stalenessTag(record);
  return `- ${record.id} [${record.layer}, conf ${record.confidence.toFixed(2)}${stale}] ${record.statement}`;
}

// ─── Relevance selection ─────────────────────────────────────────────

function promptTerms(prompt: string): Set<string> {
  return new Set(prompt.toLowerCase().split(/[^a-z0-9-]+/).filter((term) => term.length > 2));
}

function isRelevantByTerms(record: MemoryRecord, terms: Set<string>): boolean {
  if (record.layer === "L1") return true;
  const haystack = `${record.tags.join(" ")} ${record.statement}`.toLowerCase();
  return [...terms].some((term) => haystack.includes(term));
}

/** Try to parse qmd JSON search results into record IDs */
function parseQmdRecordIds(stdout: string): string[] {
  try {
    const data = JSON.parse(stdout) as { results?: Array<{ path?: string; file?: string }> };
    return (data.results ?? []).map((r) => {
      const path = r.path ?? r.file ?? "";
      const match = path.match(/mem_[a-z0-9_]+/);
      return match?.[0] ?? "";
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function selectMemoryWithQmd(
  root: string,
  prompt: string,
  collection: string,
  maxRecords: number,
): Promise<MemoryRecord[]> {
  const allRecords = loadActiveRecords(root);
  const l1 = allRecords.filter((r) => r.layer === "L1");

  try {
    const result = await runQmd(qmdSearchArgs(prompt, "semantic", maxRecords + l1.length, collection), 5_000);
    const ids = parseQmdRecordIds(result.stdout);
    if (ids.length > 0) {
      const byId = new Map(allRecords.map((r) => [r.id, r]));
      const semantic = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])).filter((r) => r.layer !== "L1");
      return [...l1, ...semantic].slice(0, maxRecords);
    }
  } catch {
    // qmd unavailable or no results — fall through to term matching
  }

  const terms = promptTerms(prompt);
  return allRecords.filter((r) => isRelevantByTerms(r, terms)).slice(0, maxRecords);
}

function selectMemoryByTerms(root: string, prompt: string, maxRecords: number): MemoryRecord[] {
  const terms = promptTerms(prompt);
  return loadActiveRecords(root).filter((r) => isRelevantByTerms(r, terms)).slice(0, maxRecords);
}

// ─── Daily digest ─────────────────────────────────────────────────────

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

// ─── Dynamic budget assembler ─────────────────────────────────────────

function assembleWithBudget(sections: Array<{ label: string; content: string }>, maxTotal: number): string {
  const parts: string[] = [];
  let used = 0;

  for (const { label, content } of sections) {
    if (!content.trim()) {
      parts.push(label, content.trim() || "_empty_", "");
      continue;
    }
    const remaining = maxTotal - used;
    if (remaining <= 50) break; // reserve 50 chars for header
    const capped = content.length > remaining ? content.slice(0, remaining - 20) + "\n... (truncated)" : content;
    parts.push(label, capped, "");
    used += capped.length + label.length;
  }

  return parts.join("\n");
}

// ─── Main retrieval function ─────────────────────────────────────────

export async function buildRetrievalContext(root: string, options: RetrievalOptions): Promise<RetrievalContext> {
  const paths = ensureMemoryDirs(root);
  const maxTotal = options.maxTotalChars ?? 14_000;
  const maxRecords = options.maxRecords ?? 12;

  const selectedMemory = options.useQmd && options.qmdCollection
    ? await selectMemoryWithQmd(root, options.prompt, options.qmdCollection, maxRecords)
    : selectMemoryByTerms(root, options.prompt, maxRecords);

  const scratchpadItems = listScratchpadItems(root).filter((item) => !item.done);
  const daily = readDailyLog(root, options.today);
  const dailyDigest = buildDailyDigest(daily, options.maxDailyChars ?? 3000);

  const header = "# Persistent Intelligence Context";

  const content = assembleWithBudget([
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
 * Suggest vault_ref values by matching candidate tags against vault concept/entity filenames.
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
