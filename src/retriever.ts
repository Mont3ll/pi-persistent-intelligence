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
import { renderHardRulesBlockWithCount } from "./rules";
import { MemoryFtsIndex } from "./search/fts";
import { mergeHybridResults, parseQmdMemoryIds } from "./search/hybrid";
import { resolveMemoryProfile } from "./profile";
import { runMemoryProcessorPipeline } from "./processors";
import { extractContestedMemory, renderContestedMemoryBlock } from "./contested-memory";
import { appendRuntimeEvent } from "./runtime-events";
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
  qmdRunner?: (args: string[], timeoutMs: number) => Promise<{ stdout: string }>;
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
  timings?: {
    loadRecordsMs: number;
    processorPipelineMs: number;
    ftsMs: number;
    qmdMs: number;
    dailyDigestMs: number;
    assemblyMs: number;
    runtimeWriteMs: number;
    totalMs: number;
  };
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
const INJECTION_QMD_BUDGET_MS = 800;

function isSubstantialPrompt(prompt: string): boolean {
  return prompt.trim().split(/\s+/).filter(Boolean).length > 8;
}

interface SelectionBudget { maxRecords: number; maxL1: number; maxL2: number }
interface SelectionTiming { ftsMs: number; qmdMs: number }

function applyLayerBudgets(l1: MemoryRecord[], l2: MemoryRecord[], budget: SelectionBudget): MemoryRecord[] {
  const selectedL1 = l1.slice(0, budget.maxL1);
  const selectedL2 = l2.slice(0, budget.maxL2);
  return [...selectedL1, ...selectedL2].slice(0, budget.maxRecords);
}

/**
 * Select relevant L2 records using hybrid FTS + qmd semantic search.
 * Falls back through: hybrid → FTS-only → term-matching.
 */
async function selectMemoryHybrid(
  root: string,
  records: MemoryRecord[],
  prompt: string,
  budget: SelectionBudget,
  timing: SelectionTiming,
  ftsIndex?: MemoryFtsIndex,
  useQmd?: boolean,
  qmdCollection?: string,
  qmdRunner: (args: string[], timeoutMs: number) => Promise<{ stdout: string }> = runQmd,
): Promise<MemoryRecord[]> {
  const l1 = records.filter((r) => r.layer === "L1");
  const l2 = records.filter((r) => r.layer === "L2");
  const eligibleIds = new Set(records.map((r) => r.id));

  if (ftsIndex?.isAvailable) {
    const ftsStart = performance.now();
    const ftsResults = ftsIndex.search(prompt, budget.maxRecords * 2).filter((result) => eligibleIds.has(result.id));
    timing.ftsMs += performance.now() - ftsStart;
    let semanticIds: string[] = [];

    if (useQmd && qmdCollection && isSubstantialPrompt(prompt)) {
      const qmdStart = performance.now();
      try {
        const result = await qmdRunner(qmdSearchArgs(prompt, "semantic", budget.maxRecords, qmdCollection), INJECTION_QMD_BUDGET_MS);
        semanticIds = parseQmdIds(result.stdout).filter((id) => eligibleIds.has(id));
      } catch (err) {
        appendRuntimeEvent(root, { type: "warn", severity: "low", component: "retriever", message: `qmd unavailable during injection; using FTS fallback: ${err instanceof Error ? err.message : String(err)}` });
      } finally {
        timing.qmdMs += performance.now() - qmdStart;
      }
    }

    const recordMap = new Map(
      l2.map((r) => [r.id, { statement: r.statement, layer: r.layer as "L1" | "L2", confidence: r.confidence, ruleType: r.ruleType }]),
    );

    const merged = mergeHybridResults(ftsResults, semanticIds, recordMap, budget.maxL2);
    const selectedL2 = merged.flatMap((h) => {
      const rec = l2.find((r) => r.id === h.id);
      return rec ? [rec] : [];
    });

    return applyLayerBudgets(l1, selectedL2, budget);
  }

  const terms = promptTerms(prompt);
  const relevantL2 = l2.filter((r) => isRelevantByTerms(r, terms));
  return applyLayerBudgets(l1, relevantL2, budget);
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

function capSectionByLine(content: string, cap: number): string {
  if (content.length <= cap) return content;
  const sliced = content.slice(0, cap);
  const lastNewline = sliced.lastIndexOf("\n");
  const safe = lastNewline > 0 ? sliced.slice(0, lastNewline) : sliced;
  return `${safe}\n[...truncated]`;
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

  const totalStart = performance.now();
  const timings = { loadRecordsMs: 0, processorPipelineMs: 0, ftsMs: 0, qmdMs: 0, dailyDigestMs: 0, assemblyMs: 0, runtimeWriteMs: 0, totalMs: 0 };
  const paths = ensureMemoryDirs(root);
  const config = loadConfig(root);
  const maxTotal = options.maxTotalChars ?? 14_000;
  const maxRecords = options.maxRecords ?? config.retrieval.maxRecords ?? 12;
  const maxL1 = config.retrieval.maxL1Records ?? Math.min(4, Math.floor(maxRecords * 0.35));
  const maxL2 = config.retrieval.maxL2Records ?? Math.max(0, maxRecords - maxL1);
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
  const loadStart = performance.now();
  const allRecords = loadAllRecords(root);
  timings.loadRecordsMs = performance.now() - loadStart;
  const processorStart = performance.now();
  const processed = runMemoryProcessorPipeline(allRecords, sessionContext);
  timings.processorPipelineMs = performance.now() - processorStart;

  const selectedMemory = await selectMemoryHybrid(
    root,
    processed.records,
    options.prompt,
    { maxRecords, maxL1, maxL2 },
    timings,
    options.ftsIndex,
    options.useQmd,
    options.qmdCollection,
    options.qmdRunner,
  );

  const scratchpadItems = listScratchpadItems(root).filter((item) => !item.done);
  const dailyStart = performance.now();
  const daily = readDailyLog(root, options.today);
  const dailyDigest = buildDailyDigest(daily, options.maxDailyChars ?? 3000);
  timings.dailyDigestMs = performance.now() - dailyStart;

  // Hard rules: high-confidence typed corrections injected prominently
  // Contested memory: from the same loaded snapshot (including non-active), context-relevant
  const contestedMemory = extractContestedMemory(allRecords, options.prompt);
  const contestedBlock = renderContestedMemoryBlock(contestedMemory, options.prompt);

  const hardRules = renderHardRulesBlockWithCount(processed.records);
  const hardRulesBlock = hardRules.block;

  const header = "# Persistent Intelligence Context";
  const sectionCaps = {
    hardRules: 2_000,
    selectedMemory: 6_000,
    scratchpad: 800,
    contested: 800,
    daily: options.maxDailyChars ?? 3_000,
  };

  const assemblyStart = performance.now();
  const content = assembleWithBudget([
    {
      label: "## Hard Rules",
      content: capSectionByLine(hardRulesBlock.replace("## Hard Rules\n", "").trim(), sectionCaps.hardRules),
    },
    {
      label: "## Selected Memory",
      content: capSectionByLine(selectedMemory.length
        ? selectedMemory.map(renderRecordBrief).join("\n")
        : "_No selected long-term memory._", sectionCaps.selectedMemory),
    },
    {
      label: "## Scratchpad",
      content: capSectionByLine(scratchpadItems.length
        ? scratchpadItems.map((item) => `- [ ] ${item.text}`).join("\n")
        : "_No open scratchpad items._", sectionCaps.scratchpad),
    },
    {
      label: "## Contested Memory",
      content: capSectionByLine(contestedBlock.replace("## Contested Memory\n", "").trim(), sectionCaps.contested),
    },
    {
      label: `## Daily Log (${options.today})`,
      content: capSectionByLine(dailyDigest || "_No daily log content._", sectionCaps.daily),
    },
  ], maxTotal - header.length);

  const markdown = `${header}\n\n${content}`;
  timings.assemblyMs = performance.now() - assemblyStart;
  const writeStart = performance.now();
  writeFileSync(paths.runtime.context, markdown, "utf-8");
  writeFileSync(paths.runtime.selected, `${JSON.stringify(selectedMemory, null, 2)}\n`, "utf-8");
  timings.runtimeWriteMs = performance.now() - writeStart;
  timings.totalMs = performance.now() - totalStart;
  writeInjectionStats(root, { generated_at: new Date().toISOString(), injectionMode: "scoped", charCount: markdown.length, selectedMemoryCount: selectedMemory.length, hardRuleCount: hardRules.count, contestedMemoryCount: contestedMemory.length, inquiryCount: 0, dailyDigestChars: dailyDigest.length, timings });
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
