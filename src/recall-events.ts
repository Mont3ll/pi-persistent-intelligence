import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";
import { ensureMemoryDirs } from "./paths";
import { redactSecrets, redactSecretsInObject } from "./secret-scanner";

export type RecallEventSource = "retrieval" | "recall_xray" | "correction" | "manual";
export type RecallEventOutcome = "selected" | "excluded" | "ignored" | "corrected" | "successful";

export interface RecallEvent {
  id: string;
  timestamp: string;
  query_hash: string;
  prompt_excerpt: string;
  selected_memory_ids: string[];
  excluded_memory_ids: string[];
  source: RecallEventSource;
  outcome?: RecallEventOutcome;
  observable_outcome?: { kind: "test" | "tool"; success: boolean; tool_name?: string };
  mutation_performed: false;
}

function recallDir(root: string): string {
  const dir = join(ensureMemoryDirs(root).runtime.dir, "recall");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function recallPath(root: string): string {
  return join(recallDir(root), "events.jsonl");
}

function cleanIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === "string" && id.trim()).map((id) => redactSecrets(id.trim())))];
}

function parseEvents(file: string): RecallEvent[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as RecallEvent]; } catch { return []; }
  });
}

function enforceRetention(root: string, referenceTimestamp: string): void {
  const file = recallPath(root);
  const events = parseEvents(file);
  if (events.length === 0) return;
  const retentionDays = loadConfig(root).privacy.diagnosticRetentionDays;
  const referenceMs = Date.parse(referenceTimestamp);
  if (!Number.isFinite(referenceMs)) return;
  const cutoff = referenceMs - retentionDays * 86_400_000;
  const retained = events.filter((event) => {
    const timestamp = Date.parse(event.timestamp);
    return !Number.isFinite(timestamp) || timestamp >= cutoff;
  });
  if (retained.length === events.length) return;
  writeFileSync(file, retained.length ? `${retained.map((event) => JSON.stringify(event)).join("\n")}\n` : "", "utf-8");
}

export function appendRecallEvent(root: string, event: RecallEvent): void {
  const privacy = loadConfig(root).privacy;
  const payload: RecallEvent = redactSecretsInObject({
    ...event,
    id: redactSecrets(event.id).slice(0, 120),
    query_hash: redactSecrets(event.query_hash).slice(0, 120),
    prompt_excerpt: privacy.persistPromptExcerpts ? redactSecrets(event.prompt_excerpt).slice(0, 240) : "",
    selected_memory_ids: cleanIds(event.selected_memory_ids),
    excluded_memory_ids: cleanIds(event.excluded_memory_ids),
    mutation_performed: false,
  }) as RecallEvent;
  appendFileSync(recallPath(root), `${JSON.stringify(payload)}\n`, "utf-8");
  enforceRetention(root, payload.timestamp);
}

export function readRecallEvents(root: string): RecallEvent[] {
  return parseEvents(recallPath(root));
}

export function createRecallEventId(now: string, queryHash: string): string {
  return `recall_${now.replace(/[-:.TZ]/g, "").slice(0, 14)}_${queryHash.slice(0, 8)}`;
}

export async function hashRecallQuery(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
