import { describe, expect, test } from "bun:test";
import { getTrustWeight, inferPoisoningRisk, inferPromotionEligibility, isAutoApplyEligibleCandidate } from "../../src/trust";
import type { CaptureCandidate } from "../../src/types";

function candidate(overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id: "cap_test",
    created_at: "2026-05-19T10:00:00.000Z",
    source: { type: "manual", ref: "daily/2026-05-19.md" },
    text: "Use bun for local tests.",
    tags: ["testing"],
    evidence_refs: ["daily/2026-05-19.md", "docs/spec.md"],
    confidence: 0.9,
    status: "new",
    ...overrides,
  };
}

describe("trust policy", () => {
  test("maps trust classes to weights", () => {
    expect(getTrustWeight("direct_user_instruction")).toBe(1);
    expect(getTrustWeight("user_correction")).toBe(1);
    expect(getTrustWeight("repeated_user_preference")).toBe(0.9);
    expect(getTrustWeight("repository_text")).toBe(0.25);
    expect(getTrustWeight("third_party_documentation")).toBe(0.2);
  });

  test("infers promotion eligibility from trust and durability", () => {
    expect(inferPromotionEligibility("direct_user_instruction", "project")).toBe("auto_candidate");
    expect(inferPromotionEligibility("user_correction", "repository")).toBe("auto_candidate");
    expect(inferPromotionEligibility("agent_inference", "project")).toBe("review_only");
    expect(inferPromotionEligibility("third_party_documentation", "long_term")).toBe("review_only");
    expect(inferPromotionEligibility("direct_user_instruction", "temporary")).toBe("review_only");
    expect(inferPromotionEligibility("direct_user_instruction", "project", "L1")).toBe("l1_review_only");
  });

  test("infers poisoning risk from low-trust sources", () => {
    expect(inferPoisoningRisk("direct_user_instruction", "project").risk).toBe("low");
    expect(inferPoisoningRisk("repository_text", "project").risk).toBe("high");
    expect(inferPoisoningRisk("generated_content", "project").risk).toBe("high");
    expect(inferPoisoningRisk("single_session_observation", "project").risk).toBe("medium");
  });

  test("blocks low-trust and temporary newly classified candidates from auto-apply", () => {
    expect(isAutoApplyEligibleCandidate(candidate({ primary_trust_class: "repository_text", promotion_eligibility: "review_only", poisoning_risk: "high" }))).toBe(false);
    expect(isAutoApplyEligibleCandidate(candidate({ primary_trust_class: "direct_user_instruction", durability_signal: "temporary", promotion_eligibility: "review_only", poisoning_risk: "low" }))).toBe(false);
    expect(isAutoApplyEligibleCandidate(candidate({ primary_trust_class: "direct_user_instruction", durability_signal: "project", promotion_eligibility: "auto_candidate", poisoning_risk: "low" }))).toBe(true);
  });

  test("legacy candidates without trust metadata remain auto-compatible", () => {
    expect(isAutoApplyEligibleCandidate(candidate())).toBe(true);
  });
});
