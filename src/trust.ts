import type { CaptureCandidate, DurabilitySignal, EvidenceTrustClass, GovernanceMode, MemoryLayer, PromotionEligibility } from "./types";

export interface CandidateTrustMetadata {
  primary_trust_class: EvidenceTrustClass;
  source_trust_weight: number;
  durability_signal: DurabilitySignal;
  promotion_eligibility: PromotionEligibility;
  poisoning_risk: "low" | "medium" | "high";
  poisoning_risk_reasons: string[];
}

const TRUST_WEIGHTS: Record<EvidenceTrustClass, number> = {
  direct_user_instruction: 1.0,
  user_correction: 1.0,
  repeated_user_preference: 0.9,
  accepted_code_review_outcome: 0.8,
  existing_project_convention: 0.65,
  passing_tool_or_test_outcome: 0.55,
  agent_inference: 0.35,
  single_session_observation: 0.3,
  repository_text: 0.25,
  generated_content: 0.2,
  third_party_documentation: 0.2,
};

const NON_DURABLE = new Set<DurabilitySignal>(["temporary", "session", "task"]);
const LOW_TRUST_REVIEW = new Set<EvidenceTrustClass>([
  "agent_inference",
  "single_session_observation",
  "repository_text",
  "generated_content",
  "third_party_documentation",
]);
const HIGH_POISONING_RISK = new Set<EvidenceTrustClass>(["repository_text", "generated_content", "third_party_documentation"]);
const MEDIUM_POISONING_RISK = new Set<EvidenceTrustClass>(["agent_inference", "single_session_observation"]);

export function getTrustWeight(trustClass: EvidenceTrustClass): number {
  return TRUST_WEIGHTS[trustClass];
}

export function inferPromotionEligibility(
  trustClass: EvidenceTrustClass,
  durability: DurabilitySignal = "unknown",
  proposedLayer: MemoryLayer = "L2",
): PromotionEligibility {
  if (proposedLayer === "L1") return "l1_review_only";
  if (durability === "unknown") return "review_only";
  if (NON_DURABLE.has(durability)) return "review_only";
  if (LOW_TRUST_REVIEW.has(trustClass)) return "review_only";
  if (trustClass === "direct_user_instruction" || trustClass === "user_correction" || trustClass === "repeated_user_preference") {
    return "auto_candidate";
  }
  if (trustClass === "accepted_code_review_outcome" || trustClass === "existing_project_convention") return "review_only";
  if (trustClass === "passing_tool_or_test_outcome") return "review_only";
  return "review_only";
}

export function inferPoisoningRisk(
  trustClass: EvidenceTrustClass,
  durability: DurabilitySignal = "unknown",
): { risk: "low" | "medium" | "high"; reasons: string[] } {
  const reasons: string[] = [];
  if (HIGH_POISONING_RISK.has(trustClass)) reasons.push(`${trustClass} cannot auto-promote operational memory.`);
  if (MEDIUM_POISONING_RISK.has(trustClass)) reasons.push(`${trustClass} requires corroboration before durable promotion.`);
  if (NON_DURABLE.has(durability)) reasons.push(`${durability} durability cannot auto-promote as durable L2.`);
  if (HIGH_POISONING_RISK.has(trustClass)) return { risk: "high", reasons };
  if (MEDIUM_POISONING_RISK.has(trustClass) || NON_DURABLE.has(durability)) return { risk: "medium", reasons };
  return { risk: "low", reasons };
}

export function buildCandidateTrustMetadata(
  trustClass: EvidenceTrustClass,
  durability: DurabilitySignal,
  proposedLayer: MemoryLayer = "L2",
): CandidateTrustMetadata {
  const poisoning = inferPoisoningRisk(trustClass, durability);
  return {
    primary_trust_class: trustClass,
    source_trust_weight: getTrustWeight(trustClass),
    durability_signal: durability,
    promotion_eligibility: inferPromotionEligibility(trustClass, durability, proposedLayer),
    poisoning_risk: poisoning.risk,
    poisoning_risk_reasons: poisoning.reasons,
  };
}

export function hasTrustMetadata(candidate: CaptureCandidate): boolean {
  return Boolean(candidate.primary_trust_class || candidate.durability_signal || candidate.promotion_eligibility || candidate.poisoning_risk);
}

export function isAutoApplyEligibleCandidate(candidate: CaptureCandidate, mode: GovernanceMode = "compatibility"): boolean {
  if (mode === "strict") {
    if (!hasTrustMetadata(candidate)) return false;
    if (!candidate.verification_status || candidate.verification_status === "legacy_unverified") return false;
    if (!candidate.evidence_ids?.length && candidate.primary_trust_class !== "direct_user_instruction") return false;
  }

  // Backward compatibility: legacy candidates written before Sprint 2 did not
  // carry trust metadata and keep the old curation behavior.
  if (!hasTrustMetadata(candidate)) return true;

  if (candidate.verification_status === "rejected" || candidate.verification_status === "review_required") return false;
  if (candidate.poisoning_risk === "high") return false;
  if (candidate.match_kind === "potential_conflict" || candidate.match_kind === "supersedes_existing" || candidate.match_kind === "ambiguous") return false;
  if (candidate.durability_signal && NON_DURABLE.has(candidate.durability_signal)) return false;
  if (candidate.promotion_eligibility === "review_only") return false;
  if (candidate.promotion_eligibility === "never") return false;
  if (candidate.promotion_eligibility === "l1_review_only") return false;
  return candidate.promotion_eligibility === "auto_candidate" || candidate.promotion_eligibility === "auto_apply_l2";
}
