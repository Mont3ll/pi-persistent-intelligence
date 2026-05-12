/**
 * Session index store — persistent JSONL index with incremental sync.
 *
 * Stores session summaries under `sessions/session-index.jsonl` in the PI
 * memory root. On startup, only parses new or modified session files
 * (change detection via mtime + sizeBytes).
 *
 * Provides:
 * - sync(): discover + parse all sessions, update stale entries
 * - search(query, opts): BM25 keyword search
 * - list(opts): filter by project/date/archived
 * - get(id): lookup by session id or file path
 * - getDecisions(since): extract #decision markers from recent sessions
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { discoverSessionFiles, parseSession, readSessionId, type ParsedSession } from "./parser";
import { buildIndex, search as bm25Search, tokenize, type BM25Index, type BM25Document } from "./bm25";

// ─── Process detection ────────────────────────────────────────────────

/** True when running as a pi subagent child or non-interactive process. */
export function isChildProcess(): boolean {
  const depth = Number(process.env.PI_SUBAGENT_DEPTH);
  if (depth > 0) return true;
  if (!process.stdin.isTTY) return true;
  return false;
}

// ─── Stored record (lean version of ParsedSession for index) ──────────

export interface SessionRecord {
  id: string;
  file: string;
  mtime: number;
  sizeBytes: number;
  date: string;
  startedAt: string;
  endedAt: string;
  cwd: string;
  project: string;
  projectSlug: string;
  archived: boolean;
  name?: string;
  models: string[];
  userMessageCount: number;
  toolsUsed: string[];
  filesModified: string[];
  firstMessage: string;
  decisions: string[];
  compactionSummaries: string[];
  totalCost: number;
  totalTokens: number;
  // Full-text fields (kept for BM25 indexing)
  _indexText: string;
}

// ─── Search / list options ────────────────────────────────────────────

export interface SearchOptions {
  query: string;
  limit?: number;
  project?: string;
  after?: string;       // ISO date string — only sessions after this date
  includeArchived?: boolean;
}

export interface ListOptions {
  project?: string;
  after?: string;
  before?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface SearchResult {
  session: SessionRecord;
  score: number;
  matchedTerms: string[];
  /** PI memory cross-ref: inbox candidate IDs from the same day */
  relatedCandidates?: string[];
}

// ─── Store ────────────────────────────────────────────────────────────

export class SessionStore {
  private indexFile: string;
  private records: Map<string, SessionRecord> = new Map();
  private bm25Index: BM25Index | null = null;
  private dirty = false;

  constructor(private readonly root: string) {
    const sessionsDir = join(root, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    this.indexFile = join(sessionsDir, "session-index.jsonl");
  }

  load(): void {
    if (!existsSync(this.indexFile)) return;
    try {
      const raw = readFileSync(this.indexFile, "utf-8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const rec = JSON.parse(trimmed) as SessionRecord;
          if (rec.id) this.records.set(rec.id, rec);
        } catch { /* skip malformed */ }
      }
    } catch { /* index not readable yet */ }
  }

  save(): void {
    if (!this.dirty) return;
    try {
      const lines = [...this.records.values()].map((r) => JSON.stringify(r));
      writeFileSync(this.indexFile, lines.join("\n") + "\n", "utf-8");
      this.dirty = false;
    } catch { /* best-effort */ }
  }

  /** Sync with session directories — parse new/modified files, remove deleted. */
  sync(): { added: number; updated: number; removed: number } {
    const found = discoverSessionFiles();
    const onDiskByFile = new Map(found.map((f) => [f.file, f]));
    let added = 0, updated = 0, removed = 0;

    // Remove deleted sessions
    for (const [id, rec] of this.records) {
      if (!existsSync(rec.file)) {
        this.records.delete(id);
        removed++;
        this.dirty = true;
      }
    }

    // Find records by file for quick mtime lookup
    const byFile = new Map<string, SessionRecord>();
    for (const rec of this.records.values()) byFile.set(rec.file, rec);

    // Parse new/changed files
    for (const { file, archived, mtime, sizeBytes } of found) {
      const existing = byFile.get(file);
      if (existing && existing.mtime === mtime && existing.sizeBytes === sizeBytes) continue;

      const parsed = parseSession(file, archived);
      if (!parsed) continue;

      const rec = toRecord(parsed);
      const wasNew = !this.records.has(rec.id);
      this.records.set(rec.id, rec);
      this.dirty = true;
      if (wasNew) added++;
      else updated++;
    }

    if (this.dirty) {
      this.bm25Index = null; // invalidate index
      this.save();
    }

    return { added, updated, removed };
  }

  private ensureIndex(): BM25Index {
    if (this.bm25Index) return this.bm25Index;
    const docs: BM25Document[] = [...this.records.values()].map((r) => ({
      id: r.id,
      text: r._indexText,
      boostFields: [r.firstMessage, r.project, r.decisions.join(" ")].join(" "),
    }));
    this.bm25Index = buildIndex(docs);
    return this.bm25Index;
  }

  search(opts: SearchOptions): SearchResult[] {
    const index = this.ensureIndex();
    const all = [...this.records.values()];

    // Pre-filter
    const filtered = all.filter((r) => {
      if (!opts.includeArchived && r.archived) return false;
      if (opts.project && !r.project.toLowerCase().includes(opts.project.toLowerCase()) && !r.projectSlug.toLowerCase().includes(opts.project.toLowerCase())) return false;
      if (opts.after && r.date < opts.after.slice(0, 10)) return false;
      return true;
    });

    const filteredIds = new Set(filtered.map((r) => r.id));
    const results = bm25Search(
      index,
      filtered,
      opts.query,
      opts.limit ?? 10,
    );

    return results
      .filter((r) => filteredIds.has(r.item.id))
      .map((r) => ({
        session: r.item as SessionRecord,
        score: r.score,
        matchedTerms: r.matchedTerms,
      }));
  }

  list(opts: ListOptions): SessionRecord[] {
    const all = [...this.records.values()].filter((r) => {
      if (!opts.includeArchived && r.archived) return false;
      if (opts.project && !r.project.toLowerCase().includes(opts.project.toLowerCase())) return false;
      if (opts.after && r.date < opts.after.slice(0, 10)) return false;
      if (opts.before && r.date > opts.before.slice(0, 10)) return false;
      return true;
    });
    all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return all.slice(0, opts.limit ?? 50);
  }

  get(idOrFile: string): SessionRecord | null {
    if (this.records.has(idOrFile)) return this.records.get(idOrFile) ?? null;
    // Try file match
    for (const rec of this.records.values()) {
      if (rec.file === idOrFile || rec.file.includes(idOrFile)) return rec;
    }
    return null;
  }

  /**
   * Get all #decision markers from sessions within the last N days.
   * Used to enrich the daily digest and surface recurring decisions.
   */
  getRecentDecisions(days = 7): { date: string; project: string; decision: string }[] {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const decisions: { date: string; project: string; decision: string }[] = [];
    for (const rec of this.records.values()) {
      if (rec.date < since) continue;
      for (const d of rec.decisions) {
        decisions.push({ date: rec.date, project: rec.project, decision: d });
      }
    }
    return decisions.sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Find sessions from the same day that reference similar topics to a
   * PI memory candidate — for cross-referencing.
   */
  getSessionsForDate(date: string): SessionRecord[] {
    return [...this.records.values()].filter((r) => r.date === date);
  }

  size(): number {
    return this.records.size;
  }

  /** Return today's sessions for context injection */
  getTodaySummary(today: string, maxSessions = 3): string {
    const sessions = this.list({ after: today, before: today, includeArchived: false, limit: maxSessions });
    if (sessions.length === 0) return "";

    const lines = [`Recent sessions (${today}):`];
    for (const s of sessions) {
      const name = s.name || s.firstMessage.slice(0, 80);
      const tools = s.toolsUsed.slice(0, 3).join(", ");
      lines.push(`- [${s.project}] ${name}${tools ? ` (${tools})` : ""}`);
      if (s.decisions.length > 0) {
        for (const d of s.decisions.slice(0, 2)) lines.push(`  ${d}`);
      }
    }
    return lines.join("\n");
  }

  /**
   * Export session summaries as markdown files into `sessions/summaries/`.
   * These are indexed by qmd for semantic session search.
   * Only exports recently changed sessions (mtime-based).
   */
  exportMarkdown(summariesDir: string, maxSessions = 500): number {
    mkdirSync(summariesDir, { recursive: true });

    // Clean up summaries for deleted sessions
    try {
      const existing = readdirSync(summariesDir).filter((f) => f.endsWith(".md"));
      const validIds = new Set([...this.records.keys()]);
      for (const file of existing) {
        const id = file.replace(/\.md$/, "");
        if (!validIds.has(id)) {
          try { unlinkSync(join(summariesDir, file)); } catch { /* ignore */ }
        }
      }
    } catch { /* summaries dir may not exist yet */ }

    let exported = 0;
    const sessions = [...this.records.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, maxSessions);

    for (const s of sessions) {
      const mdFile = join(summariesDir, `${s.id}.md`);
      // Only rewrite if the session has been updated since last export
      try {
        const existing = existsSync(mdFile) ? readFileSync(mdFile, "utf-8") : "";
        const md = buildSessionMarkdown(s);
        if (existing !== md) {
          writeFileSync(mdFile, md, "utf-8");
          exported++;
        }
      } catch {
        exported++;
      }
    }
    return exported;
  }
}

// ─── Markdown export ──────────────────────────────────────────────

export function buildSessionMarkdown(s: SessionRecord): string {
  const lines: string[] = [
    `# Session: ${s.name || s.firstMessage.slice(0, 100) || s.id}`,
    ``,
    `**Date:** ${s.date}  **Project:** ${s.project}  **CWD:** ${s.cwd}`,
    `**Messages:** ${s.userMessageCount} user  **ID:** ${s.id}`,
    `**Models:** ${s.models.join(", ") || "unknown"}`,
    ``,
  ];

  if (s.decisions.length > 0) {
    lines.push(`## Decisions`);
    for (const d of s.decisions) lines.push(`- ${d.replace(/^[- #]+/, "")}`);
    lines.push("");
  }

  if (s.filesModified.length > 0) {
    lines.push(`## Modified files`);
    for (const f of s.filesModified.slice(0, 20)) lines.push(`- ${f}`);
    lines.push("");
  }

  if (s.toolsUsed.length > 0) {
    lines.push(`## Tools used`);
    lines.push(s.toolsUsed.slice(0, 8).join(", "));
    lines.push("");
  }

  if (s.compactionSummaries.length > 0) {
    lines.push(`## Compaction summaries`);
    for (const cs of s.compactionSummaries) lines.push(cs.slice(0, 500));
    lines.push("");
  }

  // Main content for semantic indexing
  lines.push(`## Content`);
  lines.push(s._indexText.slice(0, 8_000));

  return lines.join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────

function toRecord(s: ParsedSession): SessionRecord {
  const indexParts = [
    s.firstMessage,
    s.userMessages.join(" ").slice(0, 20_000),
    s.assistantText.slice(0, 5_000),
    s.project,
    s.cwd,
    s.compactionSummaries.join(" "),
    s.branchSummaries.join(" "),
    s.decisions.join(" "),
    s.filesModified.join(" "),
    s.toolsUsed.join(" "),
  ];

  return {
    id: s.id,
    file: s.file,
    mtime: s.mtime,
    sizeBytes: s.sizeBytes,
    date: s.date,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    cwd: s.cwd,
    project: s.project,
    projectSlug: s.projectSlug,
    archived: s.archived,
    name: s.name,
    models: s.models,
    userMessageCount: s.userMessageCount,
    toolsUsed: s.toolsUsed.slice(0, 10),
    filesModified: s.filesModified.slice(0, 20),
    firstMessage: s.firstMessage.slice(0, 200),
    decisions: s.decisions.slice(0, 20),
    compactionSummaries: s.compactionSummaries.map((s) => s.slice(0, 500)),
    totalCost: s.totalCost,
    totalTokens: s.totalTokens,
    _indexText: indexParts.join(" ").slice(0, 50_000),
  };
}
