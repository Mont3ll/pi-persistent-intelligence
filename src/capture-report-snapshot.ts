import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readJsonl } from "./jsonl";
import { resolvePaths } from "./paths";
import type { CaptureCandidate, MemoryRecord } from "./types";

export function readCaptureCandidatesSnapshot(root: string): CaptureCandidate[] {
  return readJsonl<CaptureCandidate>(resolvePaths(root).inbox.captured);
}

export function readMemoryRecordsSnapshot(root: string): MemoryRecord[] {
  const paths = resolvePaths(root);
  const records = [
    ...readJsonl<MemoryRecord>(paths.memory.L1),
    ...readJsonl<MemoryRecord>(paths.memory.L2),
  ];
  if (!existsSync(paths.memory.projects)) return records;
  for (const entry of readdirSync(paths.memory.projects, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) records.push(...readJsonl<MemoryRecord>(join(paths.memory.projects, entry.name)));
  }
  return records;
}
