import { describe, expect, test } from "bun:test";
import { computeCandidateConfidence } from "../../src/confidence";
import type { EvidenceRecord } from "../../src/types";

function ev(trust_class: EvidenceRecord["trust_class"], source_kind: EvidenceRecord["source_kind"] = "conversation"): EvidenceRecord {
  return { id: `${trust_class}_${source_kind}`, resource_id: "r", profile_id: "p", created_at: "n", source_kind, source_summary: "summary", trust_class, polarity: "supports", related_memory_ids: [] };
}

describe("computed candidate confidence", () => {
  test("low-trust evidence cannot become high-confidence auto-apply signal", () => {
    const result = computeCandidateConfidence({ evidenceRecords: [ev("repository_text")], primaryTrustClass: "repository_text", userProvidedConfidence: 0.99 });
    expect(result.confidence).toBeLessThan(0.85);
    expect(result.review_required).toBe(true);
    expect(result.reasons).toContain("low_trust_confidence_ceiling");
  });

  test("direct user instruction can be high confidence but still explain source", () => {
    const result = computeCandidateConfidence({ evidenceRecords: [ev("direct_user_instruction")], primaryTrustClass: "direct_user_instruction", userProvidedConfidence: 0.92 });
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.reasons).toContain("trust_class:direct_user_instruction");
  });

  test("codebase analysis supports confidence but cannot create authority", () => {
    const result = computeCandidateConfidence({ evidenceRecords: [ev("passing_tool_or_test_outcome", "codebase_analysis")], primaryTrustClass: "passing_tool_or_test_outcome", userProvidedConfidence: 1 });
    expect(result.confidence).toBeLessThanOrEqual(0.78);
    expect(result.review_required).toBe(true);
    expect(result.reasons).toContain("codebase_analysis_support_not_authority");
  });

  test("contradictions and strict missing metadata lower confidence", () => {
    expect(computeCandidateConfidence({ evidenceRecords: [ev("user_correction")], primaryTrustClass: "user_correction", contradictionSignals: ["conflict"] }).confidence).toBeLessThan(0.85);
    const strict = computeCandidateConfidence({ governanceMode: "strict", userProvidedConfidence: 0.99 });
    expect(strict.confidence).toBeLessThan(0.5);
    expect(strict.review_required).toBe(true);
  });
});
