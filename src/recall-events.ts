import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
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

export function appendRecallEvent(root: string, event: RecallEvent): void {
  const payload: RecallEvent = redactSecretsInObject({
    ...event,
    id: redactSecrets(event.id).slice(0, 120),
    query_hash: redactSecrets(event.query_hash).slice(0, 120),
    prompt_excerpt: redactSecrets(event.prompt_excerpt).slice(0, 240),
    selected_memory_ids: cleanIds(event.selected_memory_ids),
    excluded_memory_ids: cleanIds(event.excluded_memory_ids),
    mutation_performed: false,
  }) as RecallEvent;
  appendFileSync(recallPath(root), `${JSON.stringify(payload)}\n`, "utf-8");
}

export function readRecallEvents(root: string): RecallEvent[] {
  const file = recallPath(root);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as RecallEvent]; } catch { return []; }
  });
}

export function createRecallEventId(now: string, queryHash: string): string {
  return `recall_${now.replace(/[-:.TZ]/g, "").slice(0, 14)}_${queryHash.slice(0, 8)}`;
}

export async function hashRecallQuery(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
