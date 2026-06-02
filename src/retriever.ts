import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadActiveRecords, loadAllRecords } from "./store";
import { loadConfig } from "./config";
import { listCandidates } from "./inbox";
import { ensureMemoryDirs } from "./paths";
import { listScratchpadItems } from "./scratchpad";
import { readDailyLog } from "./daily";
import { runQmd, qmdSearchArgs } from "./qmd";
import { shouldInjectMemoryContext } from "./injection-filter";
import { renderHardRulesBlock } from "./rules";
import { MemoryFtsIndex } from "./search/fts";
import { mergeHybridResults, parseQmdMemoryIds } from "./search/hybrid";
import { resolveMemoryProfile } from "./profile";
import { runMemoryProcessorPipeline } from "./processors";
import { extractContestedMemory, renderContestedMemoryBlock } from "./contested-memory";
import type { MemoryRecord, ProcessorTrace, SessionContext } from "./types";

export interface RetrievalOptions {
  prompt: string;
  today: string;
  maxDailyChars?: number;
  maxRecords?: number;
  maxTotalChars?: number;
  useQmd?: boolean;
  qmdCollection?: string;
  ftsIndex?: MemoryFtsIndex;
  cwd?: string;
  threadId?: string;
}

export type InjectionMode = "scoped" | "policy_only" | "wakeup";

export interface InjectionStats {
  generated_at: string;
  injectionMode: InjectionMode;
  charCount: number;
  selectedMemoryCount: number;
  hardRuleCount: number;
  contestedMemoryCount: number;
  inquiryCount: number;
  dailyDigestChars: number;
}

export interface RetrievalContext {
  markdown: string;
  selectedMemory: MemoryRecord[];
  processorTraces: ProcessorTrace[];
  contestedMemory: MemoryRecord[];
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
  records: MemoryRecord[],
  prompt: string,
  maxRecords: number,
  ftsIndex?: MemoryFtsIndex,
  useQmd?: boolean,
  qmdCollection?: string,
): Promise<MemoryRecord[]> {
  const l1 = records.filter((r) => r.layer === "L1");
  const l2 = records.filter((r) => r.layer === "L2");
  const eligibleIds = new Set(records.map((r) => r.id));

  // Try hybrid (FTS + qmd semantic)
  if (ftsIndex?.isAvailable) {
    const ftsResults = ftsIndex.search(prompt, maxRecords * 2).filter((result) => eligibleIds.has(result.id));
    let semanticIds: string[] = [];

    if (useQmd && qmdCollection) {
      try {
        const result = await runQmd(qmdSearchArgs(prompt, "semantic", maxRecords, qmdCollection), 5_000);
        semanticIds = parseQmdIds(result.stdout).filter((id) => eligibleIds.has(id));
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
  return records.filter((r) => isRelevantByTerms(r, terms)).slice(0, maxRecords);
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

function statsPath(root: string): string {
  return join(ensureMemoryDirs(root).runtime.dir, "injection-stats.json");
}

function writeInjectionStats(root: string, stats: InjectionStats): void {
  writeFileSync(statsPath(root), `${JSON.stringify(stats, null, 2)}\n`, "utf-8");
}

export function readLastInjectionStats(root: string): InjectionStats | null {
  const file = statsPath(root);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf-8")) as InjectionStats; } catch { return null; }
}

function hardRuleCount(markdown: string): number {
  return (markdown.match(/^📌|^AVOID|^PREFER|^RULE/gm) ?? []).length;
}

function buildPolicyOnlyContext(root: string, mode: InjectionMode): RetrievalContext {
  const paths = ensureMemoryDirs(root);
  const cfg = loadConfig(root);
  const pending = listCandidates(root);
  const markdown = [
    "# Persistent Intelligence Context",
    "",
    mode === "wakeup" ? "## Wake-up Context" : "## Memory Policy",
    `- Injection mode: ${mode}`,
    `- Governance mode: ${cfg.governance.mode}`,
    "- PI memory exists. Use memory_search or session_search when relevant.",
    "- Durable changes require patch governance. Do not assume memory without searching.",
    "- L1 records never auto-apply. Privacy-sensitive content must not be persisted.",
    mode === "wakeup" ? `- Active memory records: ${loadActiveRecords(root).length}` : "",
    mode === "wakeup" ? `- Pending candidates: ${Array.isArray(pending) ? pending.filter((c: any) => c.status === "new").length : 0}` : "",
    "",
  ].filter(Boolean).join("\n");
  writeFileSync(paths.runtime.context, markdown, "utf-8");
  writeFileSync(paths.runtime.selected, "[]\n", "utf-8");
  writeInjectionStats(root, { generated_at: new Date().toISOString(), injectionMode: mode, charCount: markdown.length, selectedMemoryCount: 0, hardRuleCount: 0, contestedMemoryCount: 0, inquiryCount: 0, dailyDigestChars: 0 });
  return { markdown, selectedMemory: [], processorTraces: [], contestedMemory: [] };
}

export async function buildRetrievalContext(root: string, options: RetrievalOptions): Promise<RetrievalContext> {
  // Skip injection for trivial prompts — saves tokens and avoids noise
  if (!shouldInjectMemoryContext(options.prompt)) {
    return { markdown: "", selectedMemory: [], processorTraces: [], contestedMemory: [] };
  }

  const mode = loadConfig(root).retrieval.injectionMode;
  if (mode === "policy_only" || mode === "wakeup") return buildPolicyOnlyContext(root, mode);

  const paths = ensureMemoryDirs(root);
  const maxTotal = options.maxTotalChars ?? 14_000;
  const maxRecords = options.maxRecords ?? 12;
  const cwd = options.cwd ?? process.cwd();
  const profile = resolveMemoryProfile(root, cwd);
  const sessionContext: SessionContext = {
    resource_id: profile.resource_id,
    profile_id: profile.profile_id,
    thread_id: options.threadId ?? "current-session",
    project_root: profile.project_identity?.git_root ?? cwd,
    repository_id: profile.project_identity?.package_name ?? profile.project_identity?.project_id,
    working_directory: cwd,
    latest_user_message: options.prompt,
    recent_files_touched: [],
    detected_domain_tags: [],
    is_trivial_prompt: false,
  };
  const processed = runMemoryProcessorPipeline(loadAllRecords(root), sessionContext);

  const selectedMemory = await selectMemoryHybrid(
    processed.records,
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
  // Contested memory: from all records (including non-active), context-relevant
  const allForContested = loadAllRecords(root);
  const contestedMemory = extractContestedMemory(allForContested, options.prompt);
  const contestedBlock = renderContestedMemoryBlock(contestedMemory, options.prompt);

  const hardRulesBlock = renderHardRulesBlock(processed.records);

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
      label: "## Contested Memory",
      content: contestedBlock.replace("## Contested Memory\n", "").trim(),
    },
    {
      label: `## Daily Log (${options.today})`,
      content: dailyDigest || "_No daily log content._",
    },
  ], maxTotal - header.length);

  const markdown = `${header}\n\n${content}`;
  writeFileSync(paths.runtime.context, markdown, "utf-8");
  writeFileSync(paths.runtime.selected, `${JSON.stringify(selectedMemory, null, 2)}\n`, "utf-8");
  writeInjectionStats(root, { generated_at: new Date().toISOString(), injectionMode: "scoped", charCount: markdown.length, selectedMemoryCount: selectedMemory.length, hardRuleCount: hardRuleCount(hardRulesBlock), contestedMemoryCount: contestedMemory.length, inquiryCount: 0, dailyDigestChars: dailyDigest.length });
  return { markdown, selectedMemory, processorTraces: processed.traces, contestedMemory };
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
