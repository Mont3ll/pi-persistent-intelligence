import { writeJsonl, appendJsonl, readJsonl } from "./jsonl";
import { ensureMemoryDirs } from "./paths";
import type { CaptureCandidate } from "./types";

export function listCandidates(root: string): CaptureCandidate[] {
  const paths = ensureMemoryDirs(root);
  return readJsonl<CaptureCandidate>(paths.inbox.captured);
}

export function appendCandidate(root: string, candidate: CaptureCandidate): void {
  const paths = ensureMemoryDirs(root);
  appendJsonl(paths.inbox.captured, candidate);
}

export function replaceCandidates(root: string, candidates: CaptureCandidate[]): void {
  const paths = ensureMemoryDirs(root);
  writeJsonl(paths.inbox.captured, candidates);
}

export function updateCandidateStatus(root: string, id: string, status: CaptureCandidate["status"]): void {
  const candidates = listCandidates(root).map((candidate) => candidate.id === id ? { ...candidate, status } : candidate);
  replaceCandidates(root, candidates);
}
