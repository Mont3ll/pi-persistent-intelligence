import { describe, expect, test } from "bun:test";
import { assessSourceEvidence } from "../../src/source-evidence-assessment";
import type { CaptureCandidate, EvidenceRecord } from "../../src/types";

function candidate(refs: string[]): CaptureCandidate {
  return {
    id: "cap_source", created_at: "2026-10-28T00:00:00Z",
    source: { type: "direct_user_instruction", ref: "session:s:turn:t" },
    text: "For this project, always follow the accepted release process.",
    tags: [], evidence_refs: refs, confidence: 0.9, status: "new",
  };
}
function evidence(id: string, sessionId = "s1", turnId = "t1"): EvidenceRecord {
  return {
    id, resource_id: "curation", profile_id: "legacy-default",
    created_at: "2026-10-28T00:00:00Z", source_kind: "conversation",
    source_ref: `session:${sessionId}:turn:${turnId}`,
    source_session_id: sessionId, source_turn_id: turnId,
    source_identity_quality: "observed_session_id",
    source_summary: "Accepted release process", trust_class: "direct_user_instruction",
    polarity: "supports", related_memory_ids: [],
  };
}

describe("read-only source evidence assessment", () => {
  test("two derived pieces of evidence from one user turn remain one attributed source", () => {
    const result = assessSourceEvidence(candidate(["e1", "e2"]), [evidence("e1"), evidence("e2")]);
    expect(result.reference_count).toBe(2);
    expect(result.resolved_count).toBe(2);
    expect(result.distinct_source_locator_count).toBe(1);
    expect(result.observed_direct_user_turn_count).toBe(1);
    expect(result.transcript_verified_direct_user_turn_count).toBe(0);
    expect(result.authority).toBe("unverified");
    expect(result.semantic_independence).toBe("unverified");
  });

  test("distinct stable user turns are countable, but semantic independence stays unproven", () => {
    const result = assessSourceEvidence(candidate(["e1", "e2"]), [
      evidence("e1", "s1", "t1"), evidence("e2", "s2", "t2"),
    ]);
    expect(result.observed_direct_user_turn_count).toBe(2);
    expect(result.transcript_verified_direct_user_turn_count).toBe(0);
    expect(result.authority).toBe("unverified");
    expect(result.semantic_independence).toBe("unverified");
  });

  test("transcript-verified evidence can establish attributed direct-user authority", () => {
    const original = { ...evidence("e1"), source_transcript_verified: true, source_message_sha256: "hash" };
    const result = assessSourceEvidence(candidate(["e1"]), [original]);
    expect(result.observed_direct_user_turn_count).toBe(1);
    expect(result.transcript_verified_direct_user_turn_count).toBe(1);
    expect(result.authority).toBe("direct_user_attributed");
    expect(result.semantic_independence).toBe("unverified");
  });

  test("old current-session and provenance-free evidence grant no attributed-user authority", () => {
    const old = { ...evidence("e1", "current-session", "t1"), source_identity_quality: "unresolved" as const };
    const legacy = { ...evidence("e2", "s1", "t2"), source_identity_quality: undefined };
    const result = assessSourceEvidence(candidate(["e1", "e2"]), [old, legacy]);
    expect(result.reference_count).toBe(2);
    expect(result.observed_direct_user_turn_count).toBe(0);
    expect(result.authority).toBe("unverified");
  });

  test("agent inference, invalidated and missing evidence cannot create direct-user authority", () => {
    const inferred = { ...evidence("e1"), trust_class: "agent_inference" as const };
    const redacted = { ...evidence("e2", "s2", "t2"), redaction_status: "redacted" as const };
    const result = assessSourceEvidence(candidate(["e1", "e2", "not-present"]), [inferred, redacted]);
    expect(result.reference_count).toBe(3);
    expect(result.unresolved_count).toBe(1);
    expect(result.invalidated_count).toBe(1);
    expect(result.observed_direct_user_turn_count).toBe(0);
    expect(result.authority).toBe("unverified");
  });
});
