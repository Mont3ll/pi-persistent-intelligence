/**
 * Session JSONL parser — reads pi session files and extracts searchable content.
 *
 * Supports pi session format v1–v3. Handles tree structure (v2/v3) by reading
 * all entries regardless of parent chain (for indexing purposes we want all text).
 * No external dependencies — pure Node.js fs module.
 */
import { readFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";

// ─── Types ───────────────────────────────────────────────────────────

export interface ParsedSession {
  file: string;
  id: string;
  startedAt: string;
  endedAt: string;
  date: string;                  // YYYY-MM-DD from startedAt
  cwd: string;
  name?: string;
  archived: boolean;
  projectSlug: string;           // raw slug e.g. "--home-mel-Projects-foo--"
  project: string;               // human-readable e.g. "foo"
  models: string[];
  userMessageCount: number;
  assistantMessageCount: number;
  toolsUsed: string[];           // top tool names, sorted by frequency
  filesModified: string[];
  filesRead: string[];
  firstMessage: string;          // first user message (for display)
  userMessages: string[];        // all user messages (for indexing)
  assistantText: string;         // assistant text (capped)
  decisions: string[];           // #decision tagged lines from user messages
  compactionSummaries: string[];
  branchSummaries: string[];
  totalCost: number;
  totalTokens: number;
  mtime: number;                 // file mtime for incremental sync
  sizeBytes: number;             // file size for change detection
}

// ─── Session directories ──────────────────────────────────────────────

const DEFAULT_SESSION_DIR = join(homedir(), ".pi", "agent", "sessions");
const DEFAULT_ARCHIVE_DIR = join(homedir(), ".pi", "agent", "sessions-archive");

export function discoverSessionFiles(
  extraSessionDirs: string[] = [],
  extraArchiveDirs: string[] = [],
): { file: string; archived: boolean; mtime: number; sizeBytes: number }[] {
  const results: { file: string; archived: boolean; mtime: number; sizeBytes: number }[] = [];

  for (const dir of [DEFAULT_SESSION_DIR, ...extraSessionDirs]) {
    if (!existsSync(dir)) continue;
    for (const file of walkJsonl(dir)) {
      try {
        const s = statSync(file);
        results.push({ file, archived: false, mtime: s.mtimeMs, sizeBytes: s.size });
      } catch { /* skip */ }
    }
  }
  for (const dir of [DEFAULT_ARCHIVE_DIR, ...extraArchiveDirs]) {
    if (!existsSync(dir)) continue;
    for (const file of walkJsonl(dir)) {
      try {
        const s = statSync(file);
        results.push({ file, archived: true, mtime: s.mtimeMs, sizeBytes: s.size });
      } catch { /* skip */ }
    }
  }
  return results;
}

function walkJsonl(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkJsonl(full));
      } else if (entry.name.endsWith(".jsonl") && entry.name !== "pins.json" && entry.name !== "active-sessions.json") {
        files.push(full);
      }
    }
  } catch { /* skip */ }
  return files;
}

// ─── Header-only read ─────────────────────────────────────────────────

export function readSessionId(file: string): string | null {
  try {
    const fd = openSync(file, "r");
    try {
      const buf = Buffer.alloc(1024);
      const bytesRead = readSync(fd, buf, 0, 1024, 0);
      const firstLine = buf.toString("utf8", 0, bytesRead).split("\n")[0];
      const obj = JSON.parse(firstLine.replace(/^\uFEFF/, "").trim());
      return obj.type === "session" ? obj.id : null;
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

// ─── Full parse ───────────────────────────────────────────────────────

const MAX_ASSISTANT_TEXT = 30_000;

export function parseSession(file: string, archived: boolean): ParsedSession | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch {
    return null;
  }

  const lines = raw.trim().split("\n");
  if (lines.length === 0) return null;

  let header: { type: "session"; version: number; id: string; timestamp: string; cwd: string } | null = null;
  const toolCounts = new Map<string, number>();
  const filesReadSet = new Set<string>();
  const filesModifiedSet = new Set<string>();
  const userMessages: string[] = [];
  const decisions: string[] = [];
  const compactionSummaries: string[] = [];
  const branchSummaries: string[] = [];
  const models = new Set<string>();
  let assistantText = "";
  let name: string | undefined;
  let lastTimestamp = "";
  let totalCost = 0;
  let totalTokens = 0;
  let userMsgCount = 0;
  let assistantMsgCount = 0;

  for (const line of lines) {
    const cleaned = line.replace(/^\uFEFF/, "").trim();
    if (!cleaned) continue;
    let obj: any;
    try { obj = JSON.parse(cleaned); } catch { continue; }

    if (obj.type === "session") {
      header = obj;
      lastTimestamp = obj.timestamp;
      continue;
    }

    if (obj.timestamp) lastTimestamp = obj.timestamp;

    switch (obj.type) {
      case "message": {
        const msg = obj.message;
        if (!msg) break;
        if (msg.role === "user") {
          userMsgCount++;
          const text = extractText(msg.content);
          if (text) {
            userMessages.push(text);
            // Extract #decision markers
            for (const line of text.split("\n")) {
              if (line.includes("#decision") || line.includes("#key")) {
                decisions.push(line.trim());
              }
            }
          }
        }
        if (msg.role === "assistant") {
          assistantMsgCount++;
          if (msg.provider && msg.model) models.add(`${msg.provider}/${msg.model}`);
          if (msg.usage) {
            totalCost += msg.usage.cost?.total ?? 0;
            totalTokens += msg.usage.totalTokens ?? 0;
          }
          if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === "text" && assistantText.length < MAX_ASSISTANT_TEXT) {
                assistantText += block.text + "\n";
              }
              if (block.type === "toolCall") {
                toolCounts.set(block.name, (toolCounts.get(block.name) ?? 0) + 1);
              }
            }
          }
        }
        if (msg.role === "toolResult") {
          const tn: string = msg.toolName ?? "";
          if (tn === "read") {
            const p = msg.details?.path as string | undefined;
            if (p) filesReadSet.add(p);
          }
          if (tn === "write" || tn === "edit") {
            const p = msg.details?.path as string | undefined;
            if (p) filesModifiedSet.add(p);
          }
        }
        break;
      }
      case "model_change":
        if (obj.provider && obj.modelId) models.add(`${obj.provider}/${obj.modelId}`);
        break;
      case "compaction":
        if (obj.summary) compactionSummaries.push(obj.summary as string);
        break;
      case "branch_summary":
        if (obj.summary) branchSummaries.push(obj.summary as string);
        break;
      case "session_info":
        if (obj.name) name = obj.name as string;
        break;
    }
  }

  if (!header) return null;

  const toolsUsed = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const parentDir = basename(dirname(file));
  const projectSlug = parentDir.startsWith("--") ? parentDir : "unknown";
  const project = slugToProject(projectSlug);

  let mtime = 0;
  let sizeBytes = 0;
  try {
    const s = statSync(file);
    mtime = s.mtimeMs;
    sizeBytes = s.size;
  } catch { /* ignore */ }

  return {
    file,
    id: header.id,
    startedAt: header.timestamp,
    endedAt: lastTimestamp || header.timestamp,
    date: header.timestamp.slice(0, 10),
    cwd: header.cwd,
    name,
    archived,
    projectSlug,
    project,
    models: [...models],
    userMessageCount: userMsgCount,
    assistantMessageCount: assistantMsgCount,
    toolsUsed,
    filesModified: [...filesModifiedSet].slice(0, 100),
    filesRead: [...filesReadSet].slice(0, 100),
    firstMessage: userMessages[0] ?? "",
    userMessages,
    assistantText: assistantText.slice(0, MAX_ASSISTANT_TEXT),
    decisions,
    compactionSummaries,
    branchSummaries,
    totalCost,
    totalTokens,
    mtime,
    sizeBytes,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as any[])
      .filter((b) => b.type === "text")
      .map((b) => b.text as string)
      .join("\n");
  }
  return "";
}

export function slugToProject(slug: string): string {
  if (!slug.startsWith("--")) return slug;
  const inner = slug.startsWith("--") && slug.endsWith("--") ? slug.slice(2, -2) : slug.slice(2);
  const parts = inner.split("-").filter(Boolean);
  // Return last meaningful segment (project name)
  const skip = new Set(["home", "root", "Users", "user", "workspace", "work", "src", "local"]);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] && !skip.has(parts[i]) && parts[i].length > 1) return parts[i];
  }
  return inner || slug;
}

/**
 * Read the full conversation from a session file for display.
 * Returns formatted markdown lines.
 */
export function readSessionConversation(file: string, offset = 0, limit = 100): string {
  let raw: string;
  try { raw = readFileSync(file, "utf-8"); } catch { return "File not found."; }

  const lines: string[] = [];
  let lineNum = 0;

  for (const rawLine of raw.trim().split("\n")) {
    const cleaned = rawLine.replace(/^\uFEFF/, "").trim();
    if (!cleaned) continue;
    let obj: any;
    try { obj = JSON.parse(cleaned); } catch { continue; }
    if (obj.type !== "message") continue;

    const msg = obj.message;
    if (!msg) continue;
    if (!["user", "assistant"].includes(msg.role)) continue;
    if (lineNum < offset) { lineNum++; continue; }
    if (lineNum >= offset + limit) break;

    const text = extractText(msg.content);
    if (!text.trim()) { lineNum++; continue; }

    const ts = new Date(obj.timestamp ?? 0).toISOString().slice(11, 16);
    lines.push(`**[${ts}] ${msg.role.toUpperCase()}**`);
    lines.push(text.slice(0, 2000));
    lines.push("");
    lineNum++;
  }

  return lines.length ? lines.join("\n") : "No messages found.";
}
