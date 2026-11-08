import { loadActiveRecords } from "./store";
import { matchCandidateToRecords } from "./matching";
import { verifyCandidate } from "./verifier";
import type { CaptureCandidate } from "./types";

/**
 * Semantic source authenticity is necessary but not sufficient for automatic
 * memory promotion. The current canonical store is a separate authority:
 * existing same-key/ambiguous/conflicting/update/supersession relationships
 * must go to review rather than being rewritten as a new low-risk add.
 *
 * Recalculate against live canonical records; never trust a persisted
 * candidate.match_kind, curator rationale text or an old proposal snapshot.
 */
export function semanticAutoCurrentStateAllowsNewAdd(
  root: string,
  candidate: CaptureCandidate,
): boolean {
  if (candidate.status !== "new" || candidate.worth_decision !== "candidate"
    || candidate.capture_source?.version !== 2
    || candidate.promotion_eligibility !== "review_only"
    || candidate.poisoning_risk === "high"
    || candidate.scope_targets?.length !== 1
    || candidate.scope_targets[0]?.type !== "project"
    || !candidate.scope_targets[0].project) return false;

  const active = loadActiveRecords(root);
  const match = matchCandidateToRecords(candidate, active);
  // Even strengthens_existing / updates_existing are review paths:
  // similarity is not independent permission to add a second rule.
  if (match.match_kind !== "new"
    || match.matched_memory_ids.length !== 0) return false;

  const checked = verifyCandidate(root, { ...candidate, ...match });
  return checked.supported
    && checked.verification_status === "verified"
    && checked.requires_human_review === false
    && checked.failure_reasons.length === 0
    && checked.scope_supported
    && checked.durability_supported;
}
