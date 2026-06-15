import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
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
  return redactSecrets(value)
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED_SECRET]")
    .replaceAll(process.env.HOME ?? "", "~")
    .slice(0, 500);
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
  } catch { /* runtime event logging must never interrupt work */ }
}

export function readRecentRuntimeEvents(root: string, options: { hours?: number; minSeverity?: RuntimeEventSeverity } = {}): RuntimeEvent[] {
  try {
    const file = eventPath(root);
    if (!existsSync(file)) return [];
    const hours = options.hours ?? 24;
    const minSeverity = options.minSeverity ?? "medium";
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return readFileSync(file, "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try { return [JSON.parse(line) as RuntimeEvent]; } catch { return []; }
      })
      .filter((event) => new Date(event.timestamp).getTime() >= cutoff)
      .filter((event) => severityRank[event.severity] >= severityRank[minSeverity]);
  } catch { return []; }
}
