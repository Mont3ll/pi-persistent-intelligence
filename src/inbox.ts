import { writeJsonl, appendJsonl, readJsonl } from "./jsonl";
import { ensureMemoryDirs } from "./paths";
import { scoreMemoryWorth } from "./memory-worth";
import { inferMemoryKind } from "./memory-kind";
import type { CaptureCandidate, MemoryWorthDecision } from "./types";

export function listCandidates(root: string): CaptureCandidate[] {
  const paths = ensureMemoryDirs(root);
  return readJsonl<CaptureCandidate>(paths.inbox.captured);
}

export function withMemoryWorth(candidate: CaptureCandidate, existingStatements: string[] = []): CaptureCandidate {
  if (candidate.worth_decision && candidate.memory_kind) return candidate;
  const worth = scoreMemoryWorth({
    observation: candidate.text,
    explicitUserRequest: candidate.primary_trust_class === "direct_user_instruction" || candidate.primary_trust_class === "user_correction",
    evidenceStrength: candidate.evidence_ids?.length ? 0.8 : candidate.evidence_refs.length ? 0.45 : 0.1,
    durability: candidate.durability_signal === "temporary" ? "temporary" : candidate.durability_signal === "task" ? "task" : candidate.durability_signal === "project" || candidate.durability_signal === "repository" ? "project" : candidate.durability_signal === "long_term" || candidate.durability_signal === "user_global" ? "long_term" : "unknown",
    scope: candidate.profile_id ?? candidate.resource_id,
    existingStatements,
  });
  return {
    ...candidate,
    memory_kind: candidate.memory_kind ?? inferMemoryKind(candidate),
    worth_decision: candidate.worth_decision ?? worth.decision,
    worth_score: candidate.worth_score ?? worth.worth_score,
    worth_reasons: candidate.worth_reasons ?? worth.reasons,
  };
}

export function shouldPersistWorthDecision(decision: MemoryWorthDecision): boolean {
  return decision === "candidate" || decision === "inquiry" || decision === "daily_only";
}

export function appendCandidate(root: string, candidate: CaptureCandidate): void {
  const paths = ensureMemoryDirs(root);
  appendJsonl(paths.inbox.captured, withMemoryWorth(candidate, listCandidates(root).map((c) => c.text)));
}

export function replaceCandidates(root: string, candidates: CaptureCandidate[]): void {
  const paths = ensureMemoryDirs(root);
  writeJsonl(paths.inbox.captured, candidates);
}

export function updateCandidateStatus(root: string, id: string, status: CaptureCandidate["status"]): void {
  const candidates = listCandidates(root).map((candidate) => candidate.id === id ? { ...candidate, status } : candidate);
  replaceCandidates(root, candidates);
}
