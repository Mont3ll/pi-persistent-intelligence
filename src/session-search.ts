/**
 * PI-native session search — tools and session store lifecycle management.
 *
 * This replaces the shim with a real implementation. Built-in advantages:
 * - No Node 24+ dependency (pure JSONL + BM25, no SQLite FTS5)
 * - BM25 keyword search with boost fields for first message and #decision markers
 * - PI memory cross-referencing: surfaces related inbox candidates by date
 * - Decision extraction: #decision / #key markers tracked per session
 * - Session-memory linkage: consolidation candidates tagged with session ID
 * - Today's sessions surfaced in context injection (alongside daily digest)
 * - No external package dependency
 */
import { SessionStore, type SearchOptions, type ListOptions } from "./sessions/store";
import { readSessionConversation, slugToProject } from "./sessions/parser";
import { listCandidates } from "./inbox";
import { formatRelativeDate } from "./sessions/utils";

export { SessionStore };
export const SESSION_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Format helpers ───────────────────────────────────────────────────

function formatSearchResult(r: { session: import("./sessions/store").SessionRecord; score: number; matchedTerms: string[]; relatedCandidates?: string[] }): string {
  const s = r.session;
  const rel = formatRelativeDate(s.startedAt);
  const name = ((s.name ?? s.firstMessage.slice(0, 80)) || '(no first message)');
  const tools = s.toolsUsed.slice(0, 4).join(", ");
  const lines = [
    `**[${s.project}] ${name}** — ${rel} (${s.date})`,
    `  ID: ${s.id}  |  Messages: ${s.userMessageCount}  |  Tools: ${tools || "none"}`,
  ];
  if (s.decisions.length > 0) {
    lines.push(`  Decisions: ${s.decisions.slice(0, 3).map((d) => d.replace(/^[- ]+/, "")).join(" · ")}`);
  }
  if (s.filesModified.length > 0) {
    lines.push(`  Modified: ${s.filesModified.slice(0, 5).join(", ")}`);
  }
  if (r.relatedCandidates?.length) {
    lines.push(`  Related PI candidates: ${r.relatedCandidates.join(", ")}`);
  }
  return lines.join("\n");
}

function formatListItem(s: import("./sessions/store").SessionRecord): string {
  const rel = formatRelativeDate(s.startedAt);
  const name = ((s.name ?? s.firstMessage.slice(0, 60)) || '(no messages)');
  return `- [${s.project}] ${name}  (${s.date}, ${rel}, id: ${s.id.slice(0, 8)})`;
}

// ─── Cross-reference helper ───────────────────────────────────────────

function crossRefWithMemory(root: string, date: string): string[] {
  try {
    const candidates = listCandidates(root).filter((c) => c.source.ref.includes(date) || c.created_at.slice(0, 10) === date);
    return candidates.map((c) => c.id);
  } catch {
    return [];
  }
}

// ─── Tool executors (called from index.ts) ────────────────────────────

export function buildSessionSearchTools(root: string, store: SessionStore) {
  return {
    async session_search(params: { query: string; project?: string; after?: string; limit?: number; include_archived?: boolean }): Promise<string> {
      const opts: SearchOptions = {
        query: params.query,
        limit: Math.min(params.limit ?? 8, 20),
        project: params.project,
        after: params.after,
        includeArchived: params.include_archived ?? false,
      };
      const results = store.search(opts);
      if (results.length === 0) return `No sessions found matching "${params.query}"${params.project ? ` in project "${params.project}"` : ""}.`;

      const lines = [`Found ${results.length} session(s) matching "${params.query}":\n`];
      for (const r of results) {
        const related = crossRefWithMemory(root, r.session.date);
        lines.push(formatSearchResult({ ...r, relatedCandidates: related.length > 0 ? related : undefined }));
        lines.push("");
      }
      return lines.join("\n");
    },

    async session_list(params: { project?: string; after?: string; before?: string; limit?: number; include_archived?: boolean }): Promise<string> {
      const opts: ListOptions = {
        project: params.project,
        after: params.after,
        before: params.before,
        includeArchived: params.include_archived ?? false,
        limit: Math.min(params.limit ?? 20, 50),
      };
      const sessions = store.list(opts);
      if (sessions.length === 0) return "No sessions found.";
      const lines = [`${sessions.length} session(s):\n`];
      for (const s of sessions) lines.push(formatListItem(s));
      return lines.join("\n");
    },

    async session_read(params: { session: string; offset?: number; limit?: number }): Promise<string> {
      const rec = store.get(params.session);
      if (!rec) return `Session "${params.session}" not found. Use session_list to find available sessions.`;
      const conv = readSessionConversation(rec.file, params.offset ?? 0, params.limit ?? 50);
      const header = [
        `**Session: ${(rec.name ?? rec.firstMessage.slice(0, 80)) || rec.id}**`,
        `Project: ${rec.project}  |  Date: ${rec.date}  |  Messages: ${rec.userMessageCount}`,
        rec.decisions.length > 0 ? `Decisions: ${rec.decisions.slice(0, 5).join(" · ")}` : "",
        "",
      ].filter(Boolean).join("\n");
      return `${header}\n${conv}`;
    },

    async session_decisions(params: { days?: number; project?: string }): Promise<string> {
      const decisions = store.getRecentDecisions(params.days ?? 7);
      const filtered = params.project
        ? decisions.filter((d) => d.project.toLowerCase().includes(params.project!.toLowerCase()))
        : decisions;
      if (filtered.length === 0) return `No #decision markers found in the last ${params.days ?? 7} days.`;
      const lines = [`Recent decisions (last ${params.days ?? 7} days):\n`];
      for (const d of filtered.slice(0, 30)) {
        lines.push(`- [${d.date}] [${d.project}] ${d.decision.replace(/^[- #]+/, "").replace(/^decision[: ]*/i, "")}`);
      }
      return lines.join("\n");
    },
  };
}

// ─── Today's session summary for context injection ────────────────────

export function buildSessionContextBlock(store: SessionStore, today: string): string {
  return store.getTodaySummary(today, 3);
}
