import { appendJsonl, readJsonl } from "./jsonl";
import { ensureMemoryDirs } from "./paths";
import type { PortablePeerEvent } from "./types";

export function readPortableEvents(root: string): PortablePeerEvent[] {
  return readJsonl<PortablePeerEvent>(ensureMemoryDirs(root).memory.portableEvents);
}

export function appendPortableEvent(root: string, event: PortablePeerEvent): void {
  if (!event.id || typeof event.id !== "string") throw new Error("Portable peer event requires a stable string id.");
  appendJsonl(ensureMemoryDirs(root).memory.portableEvents, event);
}
