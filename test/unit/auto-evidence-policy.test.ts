import { describe, expect, test } from "bun:test";
import { buildCaptureSourceAttribution } from "../../src/capture-provenance";
import { decideAutoEvidenceEligibility } from "../../src/auto-evidence-policy";
import type { CaptureCandidate, EvidenceRecord } from "../../src/types";

const message = "For this project, always use the verified release checklist.";
const sessionId = "recorded-session-001";
const turnId = "recorded-turn-001";
const ref = `session:${sessionId}:turn:${turnId}`;
const source = buildCaptureSourceAttribution(sessionId, turnId, message, message);
const config = { minEvidenceCount: 2, sourceAwareAuto: "transcript-verified-direct-user" as const };

function candidate(overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id: "cap_source_policy", created_at: "2026-10-28T00:00:00Z",
    source: { type: "direct_user_instruction", ref }, text: message,
    tags: ["capture", "project_convention"], evidence_refs: ["ev_source_policy"],
    evidence_ids: ["ev_source_policy"], confidence: 0.96, status: "new",
    primary_trust_class: "direct_user_instruction", durability_signal: "project",
    promotion_eligibility: "auto_candidate", poisoning_risk: "low",
    capture_intent: "project_convention", worth_decision: "candidate",
    capture_source: source,
    scope_targets: [{ type: "project", project: "pi", confidence: 0.9, basis: ["fixture"] }],
    ...overrides,
  };
}

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "ev_source_policy", resource_id: "curation", profile_id: "legacy-default",
    created_at: "2026-10-28T00:00:00Z", source_kind: "conversation",
    source_session_id: sessionId, source_turn_id: turnId, source_ref: ref,
    source_identity_quality: "observed_session_id", source_message_sha256: source.original_message_sha256,
    source_transcript_verified: true, source_summary: message,
    trust_class: "direct_user_instruction", polarity: "supports",
    related_memory_ids: [], redaction_status: "none", ...overrides,
  };
}

describe("source-aware automatic evidence eligibility", () => {
  test("legacy configured floor remains valid and off is the default safety posture", () => {
    expect(decideAutoEvidenceEligibility(candidate(), [evidence()], { ...config, sourceAwareAuto: "off" }))
      .toEqual({ eligible: false, basis: "below_configured_evidence_floor" });
    expect(decideAutoEvidenceEligibility(candidate({ evidence_refs: ["ev_source_policy", "second"] }), [evidence()], {
      ...config, sourceAwareAuto: "off",
    })).toEqual({ eligible: true, basis: "configured_reference_floor" });
  });

  test("one genuinely transcript-verified matching user turn is eligible only when opted in", () => {
    expect(decideAutoEvidenceEligibility(candidate(), [evidence()], config))
      .toEqual({ eligible: true, basis: "transcript_verified_direct_user" });
  });

  test("observed host session IDs alone cannot establish source authority", () => {
    expect(decideAutoEvidenceEligibility(candidate(), [evidence({ source_transcript_verified: false })], config).eligible).toBe(false);
    expect(decideAutoEvidenceEligibility(candidate({ capture_source: undefined }), [evidence()], config).eligible).toBe(false);
    expect(decideAutoEvidenceEligibility(candidate({
      capture_source: { ...source, identity_quality: "unresolved" },
    }), [evidence()], config).eligible).toBe(false);
  });

  test("source hash, ref, profile and resource must agree", () => {
    for (const evidenceOverride of [
      { source_message_sha256: "a".repeat(64) },
      { source_ref: "session:another:turn:turn" },
      { source_session_id: "another-session" },
      { source_turn_id: "another-turn" },
      { source_summary: "Different claim." },
      { resource_id: "foreign-resource" },
      { profile_id: "foreign-profile" },
      { trust_class: "agent_inference" as const },
    ]) {
      expect(decideAutoEvidenceEligibility(candidate(), [evidence(evidenceOverride)], config).eligible).toBe(false);
    }
  });

  test("invalidated or unresolved evidence and fabricated extra IDs do not satisfy the exception", () => {
    expect(decideAutoEvidenceEligibility(candidate(), [], config).eligible).toBe(false);
    expect(decideAutoEvidenceEligibility(candidate(), [evidence({ redaction_status: "redacted" })], config).eligible).toBe(false);
    expect(decideAutoEvidenceEligibility(candidate(), [evidence({ redaction_status: "deleted" })], config).eligible).toBe(false);
    expect(decideAutoEvidenceEligibility(candidate(), [evidence({ polarity: "contradicts" })], config).eligible).toBe(false);
    expect(decideAutoEvidenceEligibility(candidate({ evidence_ids: ["another-id"] }), [evidence()], config).eligible).toBe(false);
    expect(decideAutoEvidenceEligibility(candidate({ evidence_refs: ["ev_source_policy", "duplicate"] }), [evidence()], {
      minEvidenceCount: 3, sourceAwareAuto: "transcript-verified-direct-user",
    }).eligible).toBe(false);
  });

  test("no global, temporary, agent-inferred, rejected-worth, conflicted or old candidate bypass", () => {
    const invalid: Partial<CaptureCandidate>[] = [
      { status: "rejected" },
      { worth_decision: "reject" },
      { worth_decision: "daily_only" },
      { capture_intent: "temporary_instruction" },
      { capture_intent: "not_memory" },
      { durability_signal: "task" },
      { primary_trust_class: "agent_inference" },
      { promotion_eligibility: "review_only" },
      { poisoning_risk: "high" },
      { scope_targets: [{ type: "global", confidence: 0.9, basis: ["fixture"] }] },
      { scope_targets: [
        { type: "project", project: "pi", confidence: 0.9, basis: ["fixture"] },
        { type: "project", project: "other", confidence: 0.9, basis: ["fixture"] },
      ] },
    ];
    for (const fields of invalid) expect(decideAutoEvidenceEligibility(candidate(fields), [evidence()], config).eligible).toBe(false);
  });
});
