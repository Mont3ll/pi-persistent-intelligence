import type { PiMemoryConfig } from "./config";
import type { CaptureCandidate, EvidenceRecord } from "./types";
import { assessSourceEvidence } from "./source-evidence-assessment";
import { verifyCandidateTranscriptSource, type TranscriptProofOptions } from "./transcript-proof";

export type AutoEvidenceDecision = {
  eligible: boolean;
  basis: "configured_reference_floor" | "transcript_verified_direct_user" | "below_configured_evidence_floor";
};

/**
 * Only a source-verified user turn can substitute for a configured number
 * of evidence references, and only when explicitly opted in. The current
 * capture runtime creates `source_transcript_verified` as absent/false;
 * observing a host session ID alone cannot satisfy this rule.
 *
 * This is a curation eligibility contract, not authority to issue a direct
 * write. The verification, memory-worth, capture-policy, matching, scope,
 * and governed patch application gates remain mandatory.
 */
export function decideAutoEvidenceEligibility(
  candidate: CaptureCandidate,
  evidenceRecords: readonly EvidenceRecord[],
  curatorConfig: Pick<PiMemoryConfig["curator"], "minEvidenceCount" | "sourceAwareAuto">,
): AutoEvidenceDecision {
  if (candidate.evidence_refs.length >= curatorConfig.minEvidenceCount) {
    return { eligible: true, basis: "configured_reference_floor" };
  }
  const held: AutoEvidenceDecision = { eligible: false, basis: "below_configured_evidence_floor" };
  if (curatorConfig.sourceAwareAuto !== "transcript-verified-direct-user") return held;
  if (candidate.evidence_refs.length !== 1 || candidate.evidence_ids?.length !== 1) return held;
  if (candidate.evidence_ids[0] !== candidate.evidence_refs[0]) return held;
  if (candidate.status !== "new" || candidate.worth_decision !== "candidate") return held;
  if (!["project_convention", "workflow_playbook", "behavior_correction"].includes(candidate.capture_intent ?? "")) return held;
  if (candidate.durability_signal !== "project") return held;
  if (candidate.scope_targets?.length !== 1 || candidate.scope_targets[0]?.type !== "project"
    || !candidate.scope_targets[0].project) return held;
  if (candidate.promotion_eligibility !== "auto_candidate"
    || candidate.poisoning_risk === "high") return held;
  if (candidate.source.type !== "direct_user_instruction"
    && candidate.source.type !== "user_correction") return held;
  if (candidate.primary_trust_class !== candidate.source.type) return held;

  const source = candidate.capture_source;
  if (!source || source.version !== 1 || source.policy_version !== "capture-intent-v1"
    || source.identity_quality !== "observed_session_id"
    || source.session_id === "current-session" || !source.session_id
    || !source.turn_id
    || !/^[a-f0-9]{64}$/.test(source.original_message_sha256)) return held;
  if (candidate.source.ref !== `session:${source.session_id}:turn:${source.turn_id}`) return held;

  const assessment = assessSourceEvidence(candidate, evidenceRecords);
  if (assessment.reference_count !== 1 || assessment.resolved_count !== 1
    || assessment.unresolved_count !== 0 || assessment.invalidated_count !== 0
    || assessment.transcript_verified_direct_user_turn_count !== 1
    || assessment.authority !== "direct_user_attributed") return held;

  const evidence = evidenceRecords.find((item) => item.id === candidate.evidence_refs[0]);
  if (!evidence || evidence.polarity !== "supports" || evidence.source_kind !== "conversation"
    || evidence.redaction_status === "redacted" || evidence.redaction_status === "deleted"
    || evidence.trust_class !== candidate.source.type
    || evidence.source_identity_quality !== "observed_session_id"
    || evidence.source_transcript_verified !== true
    || evidence.source_session_id !== source.session_id
    || evidence.source_turn_id !== source.turn_id
    || evidence.source_ref !== candidate.source.ref
    || evidence.source_message_sha256 !== source.original_message_sha256
    || evidence.source_summary !== candidate.text
    || evidence.profile_id !== (candidate.profile_id ?? "legacy-default")
    || evidence.resource_id !== (candidate.resource_id ?? "curation")) return held;

  return { eligible: true, basis: "transcript_verified_direct_user" };
}


/**
 * Live R0d evidence gate. Unlike the synthetic R0b contract, it derives
 * transcript verification from the original Pi session at the moment of
 * curation/apply. The persisted source_transcript_verified boolean is never
 * sufficient and is deliberately overwritten in a local in-memory copy.
 *
 * The proof is recalculated at application even if the proposal was selected
 * earlier; missing/unflushed/changed transcripts fail closed for now and can
 * be reconsidered on the next curation attempt. No evidence is mutated here.
 */
export function decideTrustedAutoEvidenceEligibility(
  candidate: CaptureCandidate,
  evidenceRecords: readonly EvidenceRecord[],
  curatorConfig: Pick<PiMemoryConfig["curator"], "minEvidenceCount" | "sourceAwareAuto">,
  trustedOptions: TranscriptProofOptions = {},
): AutoEvidenceDecision {
  if (candidate.evidence_refs.length >= curatorConfig.minEvidenceCount
    || curatorConfig.sourceAwareAuto === "off") {
    return decideAutoEvidenceEligibility(candidate, evidenceRecords, curatorConfig);
  }
  const source = evidenceRecords.find((item) => item.id === candidate.evidence_refs[0]);
  if (!source) return { eligible: false, basis: "below_configured_evidence_floor" };
  const proof = verifyCandidateTranscriptSource(candidate, source, { ...trustedOptions, assessAutoSemantics: true });
  // Source authenticity is necessary, but the original turn must also be
  // an endorsed durable instruction for this exact project. A quoted UI
  // example or an opt-out may have a perfectly valid user-role source.
  if (!proof.verified || proof.auto_semantic_eligible !== true) {
    return { eligible: false, basis: "below_configured_evidence_floor" };
  }
  // Never trust a stored verification flag (including a forged true).
  // Treat it as transient proof only after independently validating the original.
  const assessed = evidenceRecords.map((record) => ({
    ...record,
    source_transcript_verified: record.id === source.id && proof.verified,
  }));
  return decideAutoEvidenceEligibility(candidate, assessed, curatorConfig);
}
