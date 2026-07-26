import { describe, expect, test } from "bun:test";
import { shouldPromptForInbox } from "../../src/tui/InboxReviewOverlay";
import type { CaptureCandidate } from "../../src/types";

function candidate(trust: CaptureCandidate["primary_trust_class"]): CaptureCandidate {
  return {
    id: `cap_${trust}`,
    created_at: "2026-07-26T00:00:00Z",
    source: { type: trust ?? "unknown", ref: "test" },
    text: "Preference",
    tags: [],
    evidence_refs: ["test"],
    confidence: 0.9,
    status: "new",
    primary_trust_class: trust,
  };
}

describe("singleton capture review", () => {
  test("surfaces one direct user preference", () => {
    expect(shouldPromptForInbox([candidate("direct_user_instruction")], { batchThreshold: 3, singletonDirectReview: true })).toBe(true);
  });

  test("surfaces one repeated preference", () => {
    expect(shouldPromptForInbox([candidate("repeated_user_preference")], { batchThreshold: 3, singletonDirectReview: true })).toBe(true);
  });

  test("retains batch threshold for one inferred candidate", () => {
    expect(shouldPromptForInbox([candidate("agent_inference")], { batchThreshold: 3, singletonDirectReview: true })).toBe(false);
  });

  test("respects disabled singleton review", () => {
    expect(shouldPromptForInbox([candidate("direct_user_instruction")], { batchThreshold: 3, singletonDirectReview: false })).toBe(false);
  });
});
