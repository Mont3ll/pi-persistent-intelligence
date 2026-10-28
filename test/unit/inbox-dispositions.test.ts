import { describe, expect, test } from "bun:test";
import { explainCandidateDisposition, explainInboxDispositions } from "../../src/inbox-dispositions";
import { candidateBrowserOptions } from "../../src/tui/browser-adapters";
import type { CaptureCandidate, EvidenceRecord } from "../../src/types";

const config = { minConfidence: 0.82, minEvidenceCount: 2, sourceAwareAuto: "off" as const };
function candidate(partial: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id: "cap_a", created_at: "2026-10-28T00:00:00Z",
    status: "new", source: { type: "direct_user_instruction", ref: "session:s:turn:t" },
    text: "For this project, always use the agreed testing checklist.",
    tags: ["project_convention"], confidence: 0.96, evidence_refs: ["e1"],
    evidence_ids: ["e1"], worth_decision: "candidate",
    capture_intent: "project_convention", promotion_eligibility: "auto_candidate",
    primary_trust_class: "direct_user_instruction",
    durability_signal: "project", poisoning_risk: "low",
    ...partial,
  };
}
function evidence(id = "e1", partial: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id, resource_id: "curation", profile_id: "legacy-default",
    created_at: "2026-10-28T00:00:00Z",
    source_kind: "conversation", source_ref: "session:s:turn:t",
    source_summary: "For this project, always use the agreed testing checklist.",
    trust_class: "direct_user_instruction", polarity: "supports",
    related_memory_ids: [], redaction_status: "none",
    ...partial,
  };
}

describe("read-only inbox dispositions", () => {
  test("one-source candidate explains the configured floor while opt-in stays off", () => {
    const item = explainCandidateDisposition(candidate(), [evidence()], config);
    expect(item.disposition).toBe("evidence_hold");
    expect(item.reason_codes).toContain("below_configured_reference_floor");
    expect(item.reason_codes).toContain("source_aware_policy_off");
    expect(item.original_transcript_checked).toBe(false);
    expect(item.automatic_approval_confirmed).toBe(false);
    expect(item.recommendation).toBe("human_review");
  });
  test("opt-in does not claim original proof from a forged stored flag", () => {
    const item = explainCandidateDisposition(candidate(), [
      evidence("e1", { source_transcript_verified: true }),
    ], { ...config, sourceAwareAuto: "transcript-verified-direct-user" });
    expect(item.reason_codes).toContain("original_transcript_proof_not_checked");
    expect(item.recommendation).toBe("verify_source_then_retry");
    expect(item.automatic_approval_confirmed).toBe(false);
  });
  test("two references are not presented as automatically approved", () => {
    const item = explainCandidateDisposition(candidate({
      evidence_refs: ["e1", "e2"], evidence_ids: ["e1", "e2"],
    }), [evidence(), evidence("e2")], config);
    expect(item.disposition).toBe("proposal_possible");
    expect(item.automatic_approval_confirmed).toBe(false);
    expect(item.original_transcript_checked).toBe(false);
  });
  test("invalidated and unresolved references remain visible", () => {
    const item = explainCandidateDisposition(candidate({
      evidence_refs: ["e1", "unknown"],
    }), [evidence("e1", { redaction_status: "deleted" })], config);
    expect(item.disposition).toBe("evidence_hold");
    expect(item.reason_codes).toContain("invalidated_evidence");
    expect(item.reason_codes).toContain("unresolved_evidence_reference");
    expect(item.evidence_resolved).toBe(1);
    expect(item.evidence_invalidated).toBe(1);
  });
  test("review-only, conflicting and non-durable candidates are not labeled proposal-ready", () => {
    const item = explainCandidateDisposition(candidate({
      promotion_eligibility: "review_only",
      match_kind: "potential_conflict",
      worth_decision: "daily_only",
    }), [evidence()], config);
    expect(item.disposition).toBe("policy_hold");
    expect(item.reason_codes).toContain("promotion_review_only");
    expect(item.reason_codes).toContain("match_requires_review");
    expect(item.reason_codes).toContain("worth_not_candidate");
  });
  test("terminal candidates remain terminal and report no mutation", () => {
    const c = candidate({ status: "patched" });
    const baseline = JSON.stringify(c);
    const item = explainCandidateDisposition(c, [evidence()], config);
    expect(item.disposition).toBe("terminal");
    expect(item.reason_codes).toEqual(["candidate_patched"]);
    expect(item.recommendation).toBe("no_action");
    expect(JSON.stringify(c)).toBe(baseline);
  });
  test("browser detail and queue status show limitations, not a false approval", () => {
    const c = candidate();
    const diagnostics = explainInboxDispositions([c], [evidence()], config);
    const browser = candidateBrowserOptions([c], diagnostics);
    expect(browser.items[0]?.details?.join("\n")).toContain("original transcript NOT checked");
    expect(browser.items[0]?.details?.join("\n")).toContain("below_configured_reference_floor");
    expect(browser.items[0]?.status).toBe("warning");
    expect(browser.columns.some((col) => col.key === "queue")).toBe(true);
    expect(browser.actions?.map((action) => action.action)).toEqual(["approve", "review", "skip"]);
  });
});
