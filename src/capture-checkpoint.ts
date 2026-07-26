import { readJsonl, writeJsonl } from "./jsonl";
import { ensureMemoryDirs } from "./paths";

export interface CaptureCheckpoint {
  session_id: string;
  last_turn_id: string;
  processed_message_hashes: string[];
  updated_at: string;
}

const MAX_MESSAGE_HASHES = 60;

export function readCaptureCheckpoint(root: string, sessionId: string): CaptureCheckpoint | null {
  return readJsonl<CaptureCheckpoint>(ensureMemoryDirs(root).runtime.captureCheckpoints)
    .find((item) => item.session_id === sessionId) ?? null;
}

export function writeCaptureCheckpoint(root: string, checkpoint: CaptureCheckpoint): void {
  const path = ensureMemoryDirs(root).runtime.captureCheckpoints;
  const rows = readJsonl<CaptureCheckpoint>(path).filter((item) => item.session_id !== checkpoint.session_id);
  rows.push({ ...checkpoint, processed_message_hashes: [...new Set(checkpoint.processed_message_hashes)].slice(-MAX_MESSAGE_HASHES) });
  rows.sort((a, b) => a.session_id.localeCompare(b.session_id));
  writeJsonl(path, rows);
}

export function hasProcessedMessage(checkpoint: CaptureCheckpoint | null, hash: string): boolean {
  return checkpoint?.processed_message_hashes.includes(hash) ?? false;
}
