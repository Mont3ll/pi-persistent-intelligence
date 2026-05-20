import { getCandidateMemoryKey, getRecordMemoryKey } from "./memory-key";
import type { CandidateMatchKind, CaptureCandidate, MemoryRecord } from "./types";

export interface CandidateMatchResult {
  match_kind: CandidateMatchKind;
  matched_memory_ids: string[];
  match_reasons: string[];
  normalized_key: string;
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
}

function jaccard(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (aTokens.size === 0 && bTokens.size === 0) return 1;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = aTokens.size + bTokens.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function contradictionCue(text: string): boolean {
  return /\b(no longer|instead of|rather than|replace|replaces|deprecated|do not|don't|avoid|stop|never use)\b/i.test(text);
}

function updateCue(text: string): boolean {
  return /\b(update|change|revise|adjust|extend|include|add|now)\b/i.test(text);
}

function explicitSupersedes(candidate: CaptureCandidate): string | null {
  const tag = candidate.tags.find((item) => item.startsWith("supersedes:"));
  if (tag) return tag.slice("supersedes:".length);
  const match = candidate.text.match(/\bsupersedes\s+([a-zA-Z0-9_-]+)/i);
  return match?.[1] ?? null;
}

function sameProfile(candidate: CaptureCandidate, record: MemoryRecord): boolean {
  // Legacy records/candidates are compatible; explicit mismatches are isolated.
  if (!candidate.profile_id || !record.profile_id) return true;
  return candidate.profile_id === record.profile_id;
}

export function matchCandidateToRecords(candidate: CaptureCandidate, records: MemoryRecord[]): CandidateMatchResult {
  const normalizedKey = getCandidateMemoryKey(candidate);
  const explicitTarget = explicitSupersedes(candidate);
  if (explicitTarget) {
    const target = records.find((record) => record.id === explicitTarget && sameProfile(candidate, record));
    if (target) {
      return {
        match_kind: "supersedes_existing",
        matched_memory_ids: [target.id],
        match_reasons: [`candidate explicitly supersedes ${target.id}`],
        normalized_key: normalizedKey,
      };
    }
  }

  const sameKey = records.filter((record) => record.status === "active" && sameProfile(candidate, record) && getRecordMemoryKey(record) === normalizedKey);
  if (sameKey.length === 0) {
    return { match_kind: "new", matched_memory_ids: [], match_reasons: ["no active memory with same normalized key"], normalized_key: normalizedKey };
  }

  if (sameKey.length > 1) {
    return {
      match_kind: "ambiguous",
      matched_memory_ids: sameKey.map((record) => record.id),
      match_reasons: ["multiple active memories share normalized key"],
      normalized_key: normalizedKey,
    };
  }

  const record = sameKey[0];
  const similarity = jaccard(candidate.text, record.statement);
  if (similarity >= 0.85) {
    return { match_kind: "duplicate", matched_memory_ids: [record.id], match_reasons: [`statement similarity ${similarity.toFixed(2)}`], normalized_key: normalizedKey };
  }
  if (contradictionCue(candidate.text)) {
    return { match_kind: "potential_conflict", matched_memory_ids: [record.id], match_reasons: ["contradiction cue with same normalized key"], normalized_key: normalizedKey };
  }
  if (updateCue(candidate.text)) {
    return { match_kind: "updates_existing", matched_memory_ids: [record.id], match_reasons: ["update cue with same normalized key"], normalized_key: normalizedKey };
  }
  return { match_kind: "strengthens_existing", matched_memory_ids: [record.id], match_reasons: ["same normalized key with non-duplicate supporting statement"], normalized_key: normalizedKey };
}

export function applyCandidateMatch(candidate: CaptureCandidate, records: MemoryRecord[]): CaptureCandidate {
  if (candidate.match_kind) return { ...candidate, normalized_key: candidate.normalized_key ?? getCandidateMemoryKey(candidate) };
  const match = matchCandidateToRecords(candidate, records);
  return { ...candidate, ...match };
}
