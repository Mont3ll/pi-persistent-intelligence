import { readEvidenceRecords } from "./evidence";
import { memoryIdFromCandidateId } from "./memory-key";
import { isTombstonedRecord } from "./tombstones";
import type { CaptureCandidate, EvidenceRecord, VerificationFailureReason, VerificationResult } from "./types";

const LOW_TRUST = new Set(["agent_inference", "single_session_observation", "repository_text", "generated_content", "third_party_documentation"]);
const NON_DURABLE = new Set(["temporary", "session", "task"]);
const REVIEW_MATCHES = new Set(["potential_conflict", "supersedes_existing", "ambiguous"]);

function hasVerificationMetadata(candidate: CaptureCandidate): boolean {
  return Boolean(candidate.evidence_ids || candidate.primary_trust_class || candidate.durability_signal || candidate.promotion_eligibility || candidate.poisoning_risk || candidate.match_kind);
}

function sourceSupports(candidate: CaptureCandidate, evidence: EvidenceRecord[]): boolean {
  const haystack = evidence.map((item) => `${item.source_summary} ${item.source_excerpt ?? ""}`).join(" ").toLowerCase();
  const tokens = candidate.text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3);
  if (tokens.length === 0) return true;
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  return matched / tokens.length >= 0.35;
}

function baseResult(): VerificationResult {
  return {
    supported: false,
    verification_status: "review_required",
    failure_reasons: [],
    unsupported_claims: [],
    scope_supported: true,
    durability_supported: true,
    poisoning_risk: "low",
    verification_notes: [],
    requires_human_review: true,
  };
}

export function verifyCandidate(root: string, candidate: CaptureCandidate): VerificationResult {
  if (!hasVerificationMetadata(candidate)) {
    return { ...baseResult(), supported: true, verification_status: "legacy_unverified", requires_human_review: false, verification_notes: ["Legacy candidate without Sprint 2+ metadata; preserving compatibility."] };
  }

  const result = baseResult();
  result.trust_class = candidate.primary_trust_class;
  result.poisoning_risk = candidate.poisoning_risk ?? "low";

  if (isTombstonedRecord(root, candidate.id) || isTombstonedRecord(root, memoryIdFromCandidateId(candidate.id))) {
    result.failure_reasons.push("tombstoned_recreation");
    result.verification_status = "rejected";
  }

  const evidence = candidate.evidence_ids?.length
    ? readEvidenceRecords(root).filter((item) => candidate.evidence_ids?.includes(item.id))
    : [];

  if ((candidate.evidence_ids?.length ?? 0) > 0 && evidence.length === 0) {
    result.failure_reasons.push("missing_evidence");
  }

  if (evidence.some((item) => item.redaction_status === "deleted" || item.redaction_status === "redacted")) {
    result.failure_reasons.push("redacted_or_deleted_evidence");
    result.verification_status = "rejected";
  }

  if (evidence.length > 0 && !sourceSupports(candidate, evidence)) {
    result.failure_reasons.push("source_not_supportive");
    result.unsupported_claims.push(candidate.text);
  }

  if (candidate.durability_signal && NON_DURABLE.has(candidate.durability_signal)) {
    result.failure_reasons.push("temporary_durability");
    result.durability_supported = false;
  }

  if (candidate.primary_trust_class && LOW_TRUST.has(candidate.primary_trust_class)) {
    result.failure_reasons.push("low_trust_source");
  }

  if (candidate.poisoning_risk === "high") {
    result.failure_reasons.push("high_poisoning_risk");
  }

  if (candidate.match_kind && REVIEW_MATCHES.has(candidate.match_kind)) {
    result.failure_reasons.push("match_requires_review");
  }

  const severe = result.failure_reasons.includes("redacted_or_deleted_evidence") || result.failure_reasons.includes("tombstoned_recreation");
  if (severe) {
    result.supported = false;
    result.verification_status = "rejected";
    result.requires_human_review = true;
    return result;
  }

  if (result.failure_reasons.length > 0) {
    result.supported = false;
    result.verification_status = "review_required";
    result.requires_human_review = true;
    return result;
  }

  result.supported = true;
  result.verification_status = "verified";
  result.requires_human_review = false;
  result.verification_notes.push("Deterministic verification passed.");
  return result;
}

export function attachVerification(root: string, candidate: CaptureCandidate): CaptureCandidate {
  const verification = verifyCandidate(root, candidate);
  return { ...candidate, verification_status: verification.verification_status, verification_result: verification };
}
