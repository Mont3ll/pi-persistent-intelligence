import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";
import { ensureMemoryDirs } from "./paths";
import { redactSecrets } from "./secret-scanner";

export type RuntimeEventSeverity = "low" | "medium" | "high";

export interface RuntimeEvent {
  type: "info" | "warn" | "error";
  severity: RuntimeEventSeverity;
  component: string;
  message: string;
  timestamp: string;
}

const severityRank: Record<RuntimeEventSeverity, number> = { low: 0, medium: 1, high: 2 };

function eventPath(root: string): string {
  return join(ensureMemoryDirs(root).runtime.dir, "events.jsonl");
}

function sanitize(value: string): string {
  const home = process.env.HOME;
  const redacted = redactSecrets(value).replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED_SECRET]");
  return (home ? redacted.replaceAll(home, "~") : redacted).slice(0, 500);
}

function parseEvents(file: string): RuntimeEvent[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line) as RuntimeEvent]; } catch { return []; }
    });
}

function enforceRetention(root: string, referenceTimestamp: string): void {
  const file = eventPath(root);
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

export function appendRuntimeEvent(root: string, event: Omit<RuntimeEvent, "timestamp"> & { timestamp?: string }): void {
  try {
    const payload: RuntimeEvent = {
      ...event,
      component: sanitize(event.component),
      message: sanitize(event.message),
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    appendFileSync(eventPath(root), `${JSON.stringify(payload)}\n`, "utf-8");
    enforceRetention(root, payload.timestamp);
  } catch { /* runtime event logging must never interrupt work */ }
}

export function readRecentRuntimeEvents(root: string, options: { hours?: number; minSeverity?: RuntimeEventSeverity; now?: string } = {}): RuntimeEvent[] {
  try {
    const hours = options.hours ?? 24;
    const minSeverity = options.minSeverity ?? "medium";
    const nowMs = options.now ? new Date(options.now).getTime() : Date.now();
    const cutoff = (Number.isFinite(nowMs) ? nowMs : Date.now()) - hours * 60 * 60 * 1000;
    return parseEvents(eventPath(root))
      .filter((event) => new Date(event.timestamp).getTime() >= cutoff)
      .filter((event) => severityRank[event.severity] >= severityRank[minSeverity]);
  } catch { return []; }
}
