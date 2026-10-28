import type { CaptureCandidate, EvidenceRecord } from "./types";

export interface SourceEvidenceAssessment {
  reference_count: number;
  resolved_count: number;
  unresolved_count: number;
  invalidated_count: number;
  distinct_source_locator_count: number;
  /** Distinct observed user-turn locators (not transcript-verified). */
  observed_direct_user_turn_count: number;
  /** Direct-user turns with an independently verified original transcript/hash. */
  transcript_verified_direct_user_turn_count: number;
  /** Do not infer semantic independence from distinct locators or evidence IDs. */
  semantic_independence: "unverified";
  authority: "direct_user_attributed" | "unverified";
}

const USER_AUTHORITY = new Set([
  "direct_user_instruction",
  "user_correction",
  "repeated_user_preference",
]);

export function assessSourceEvidence(
  candidate: CaptureCandidate,
  evidence: readonly EvidenceRecord[],
): SourceEvidenceAssessment {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const refs = [...new Set(candidate.evidence_refs)];
  const resolved = refs.map((ref) => byId.get(ref)).filter((item): item is EvidenceRecord => Boolean(item));
  const valid = resolved.filter((item) =>
    item.polarity === "supports" &&
    item.redaction_status !== "deleted" &&
    item.redaction_status !== "redacted"
  );
  const userTurns = new Set<string>();
  const verifiedUserTurns = new Set<string>();
  const locators = new Set<string>();
  for (const item of valid) {
    if (item.source_ref) locators.add(item.source_ref);
    if (item.source_kind !== "conversation" || !USER_AUTHORITY.has(item.trust_class)) continue;
    if (item.source_identity_quality !== "observed_session_id") continue;
    if (!item.source_session_id || !item.source_turn_id
      || item.source_session_id === "current-session") continue;
    const turnKey = `${item.source_session_id}:turn:${item.source_turn_id}`;
    userTurns.add(turnKey);
    if (item.source_transcript_verified === true && item.source_message_sha256) verifiedUserTurns.add(turnKey);
  }
  const invalidatedCount = resolved.filter((item) =>
    item.redaction_status === "deleted" || item.redaction_status === "redacted"
  ).length;
  return {
    reference_count: refs.length,
    resolved_count: resolved.length,
    unresolved_count: refs.length - resolved.length,
    invalidated_count: invalidatedCount,
    distinct_source_locator_count: locators.size,
    observed_direct_user_turn_count: userTurns.size,
    transcript_verified_direct_user_turn_count: verifiedUserTurns.size,
    semantic_independence: "unverified",
    authority: verifiedUserTurns.size > 0 ? "direct_user_attributed" : "unverified",
  };
}
