import { classifyCaptureIntent } from "./capture-intent";
import type { PiMemoryConfig } from "./config";
import { assessSourceEvidence } from "./source-evidence-assessment";
import type { CaptureCandidate, EvidenceRecord } from "./types";

/** Explain current inbox state without granting promotion authority or writing data. */
export type InboxDisposition =
  | "terminal"
  | "policy_hold"
  | "evidence_hold"
  | "review_required"
  | "proposal_possible";

export interface CandidateDisposition {
  candidate_id: string;
  disposition: InboxDisposition;
  reason_codes: string[];
  evidence_refs: number;
  evidence_resolved: number;
  evidence_invalidated: number;
  /** This view does NOT inspect original Pi transcripts or apply patches. */
  original_transcript_checked: false;
  automatic_approval_confirmed: false;
  recommendation: "no_action" | "human_review" | "verify_source_then_retry" | "generate_governed_proposal";
}

type Config = Pick<PiMemoryConfig["curator"], "minEvidenceCount" | "minConfidence" | "sourceAwareAuto">;

/**
 * This is intentionally a conservative queue explanation, not a duplicate
 * implementation of eligibility or governed patch application.
 *
 * Proof may be gained only from original transcripts when the curator runs.
 * No stored source_transcript_verified flag or reference count is sufficient
 * to mark a candidate as definitely auto-eligible here.
 */
export function explainCandidateDisposition(
  candidate: CaptureCandidate,
  evidence: readonly EvidenceRecord[],
  config: Config,
): CandidateDisposition {
  const reasons: string[] = [];
  const observed = assessSourceEvidence(candidate, evidence);
  let disposition: InboxDisposition = "proposal_possible";
  let recommendation: CandidateDisposition["recommendation"] = "generate_governed_proposal";

  if (candidate.status !== "new") {
    return {
      candidate_id: candidate.id, disposition: "terminal",
      reason_codes: ["candidate_" + candidate.status],
      evidence_refs: observed.reference_count,
      evidence_resolved: observed.resolved_count,
      evidence_invalidated: observed.invalidated_count,
      original_transcript_checked: false, automatic_approval_confirmed: false,
      recommendation: "no_action",
    };
  }

  if ((candidate.confidence ?? 0) < config.minConfidence) reasons.push("below_confidence_floor");
  if (candidate.worth_decision && candidate.worth_decision !== "candidate") reasons.push("worth_not_candidate");
  if (candidate.poisoning_risk === "high") reasons.push("high_poisoning_risk");
  if (["review_only", "l1_review_only", "never"].includes(candidate.promotion_eligibility ?? "")) {
    reasons.push("promotion_review_only");
  }
  if (candidate.verification_status === "review_required" || candidate.verification_status === "rejected") {
    reasons.push("verification_requires_review");
  }
  if (["potential_conflict", "supersedes_existing", "ambiguous"].includes(candidate.match_kind ?? "")) {
    reasons.push("match_requires_review");
  }

  const current = classifyCaptureIntent(candidate.text);
  const noCueOnly = current.intent === "not_memory" && current.reasons.length === 1
    && current.reasons[0] === "no_durable_intent";
  if (noCueOnly) reasons.push("current_no_durable_intent_review");
  else if (current.intent === "temporary_instruction" || current.intent === "not_memory"
    || current.durability === "temporary" || current.durability === "task") {
    reasons.push("current_non_durable_policy_hold");
  }
  if (candidate.capture_intent && candidate.capture_intent !== current.intent) {
    reasons.push("stored_current_intent_disagree");
  }

  if (observed.unresolved_count > 0) reasons.push("unresolved_evidence_reference");
  if (observed.invalidated_count > 0) reasons.push("invalidated_evidence");
  const belowFloor = observed.reference_count < config.minEvidenceCount;
  if (belowFloor) {
    reasons.push("below_configured_reference_floor");
    if (config.sourceAwareAuto === "off") {
      reasons.push("source_aware_policy_off");
    } else {
      reasons.push("original_transcript_proof_not_checked");
    }
  }

  const hardHold = reasons.some((reason) => [
    "worth_not_candidate", "current_non_durable_policy_hold", "high_poisoning_risk",
  ].includes(reason));
  const evidenceHold = reasons.some((reason) => [
    "below_configured_reference_floor", "unresolved_evidence_reference", "invalidated_evidence",
  ].includes(reason));
  if (hardHold) {
    disposition = "policy_hold";
    recommendation = "human_review";
  } else if (evidenceHold) {
    disposition = "evidence_hold";
    recommendation = belowFloor && config.sourceAwareAuto !== "off"
      ? "verify_source_then_retry" : "human_review";
  } else if (reasons.length > 0) {
    disposition = "review_required";
    recommendation = "human_review";
  }
  return {
    candidate_id: candidate.id, disposition,
    reason_codes: [...new Set(reasons)],
    evidence_refs: observed.reference_count,
    evidence_resolved: observed.resolved_count,
    evidence_invalidated: observed.invalidated_count,
    original_transcript_checked: false,
    automatic_approval_confirmed: false,
    recommendation,
  };
}

export function explainInboxDispositions(
  candidates: readonly CaptureCandidate[],
  evidence: readonly EvidenceRecord[],
  config: Config,
): Map<string, CandidateDisposition> {
  return new Map(candidates.map((candidate) => [
    candidate.id, explainCandidateDisposition(candidate, evidence, config),
  ]));
}
