import { describe, expect, test } from "bun:test";
import { matchCandidateToRecords } from "../../src/matching";
import { isAutoApplyEligibleCandidate } from "../../src/trust";
import type { CaptureCandidate, MemoryRecord } from "../../src/types";

function record(id: string, statement: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "project", project: "pi" },
    tags: ["memory"],
    statement,
    evidence: [{ type: "manual", ref: "x", note: "n" }],
    confidence: 0.8,
    stability: "semi-stable",
    created_at: "2026-05-19",
    updated_at: "2026-05-19",
    review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "If contradicted, revise." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "workflow",
    profile_id: "project:pi",
    normalized_key: "project-pi|project|pi|memory|workflow",
    ...overrides,
  };
}

function candidate(text: string, overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id: "cap_1",
    created_at: "2026-05-19T10:00:00.000Z",
    source: { type: "manual", ref: "daily" },
    text,
    tags: ["memory"],
    evidence_refs: ["a", "b"],
    confidence: 0.9,
    status: "new",
    ruleType: "workflow",
    profile_id: "project:pi",
    normalized_key: "project-pi|project|pi|memory|workflow",
    primary_trust_class: "direct_user_instruction",
    durability_signal: "project",
    promotion_eligibility: "auto_candidate",
    poisoning_risk: "low",
    ...overrides,
  };
}

describe("candidate matching", () => {
  test("detects duplicate candidates", () => {
    const existing = record("mem_1", "Use canonical JSONL as the source of truth.");
    const match = matchCandidateToRecords(candidate("Use canonical JSONL as the source of truth."), [existing]);
    expect(match.match_kind).toBe("duplicate");
    expect(match.matched_memory_ids).toEqual(["mem_1"]);
  });

  test("detects strengthening candidates with same key", () => {
    const existing = record("mem_1", "Use canonical JSONL as the source of truth.");
    const match = matchCandidateToRecords(candidate("Use canonical JSONL as the source of truth for memory records."), [existing]);
    expect(match.match_kind).toBe("strengthens_existing");
  });

  test("detects update candidates", () => {
    const existing = record("mem_1", "Use canonical JSONL for memory.");
    const match = matchCandidateToRecords(candidate("Update canonical JSONL workflow to include profiles."), [existing]);
    expect(match.match_kind).toBe("updates_existing");
  });

  test("detects potential conflicts", () => {
    const existing = record("mem_1", "Use canonical JSONL for memory.");
    const match = matchCandidateToRecords(candidate("Do not use canonical JSONL for memory."), [existing]);
    expect(match.match_kind).toBe("potential_conflict");
    expect(isAutoApplyEligibleCandidate({ ...candidate("Do not use canonical JSONL for memory."), ...match })).toBe(false);
  });

  test("detects explicit supersession", () => {
    const existing = record("mem_1", "Use canonical JSONL for memory.");
    const match = matchCandidateToRecords(candidate("Use SQLite instead for memory.", { tags: ["memory", "supersedes:mem_1"] }), [existing]);
    expect(match.match_kind).toBe("supersedes_existing");
    expect(match.matched_memory_ids).toEqual(["mem_1"]);
    expect(isAutoApplyEligibleCandidate({ ...candidate("Use SQLite instead for memory."), ...match })).toBe(false);
  });

  test("respects profile boundaries when matching", () => {
    const other = record("mem_other", "Use canonical JSONL as the source of truth.", { profile_id: "project:other", normalized_key: "project-other|project|pi|memory|workflow" });
    const match = matchCandidateToRecords(candidate("Use canonical JSONL as the source of truth."), [other]);
    expect(match.match_kind).toBe("new");
    expect(match.matched_memory_ids).toEqual([]);
  });

  test("marks multiple same-key matches as ambiguous and blocks auto-apply", () => {
    const a = record("mem_a", "Use canonical JSONL for memory.");
    const b = record("mem_b", "Use JSONL as canonical memory storage.");
    const match = matchCandidateToRecords(candidate("Use canonical JSONL for memory records."), [a, b]);
    expect(match.match_kind).toBe("ambiguous");
    expect(isAutoApplyEligibleCandidate({ ...candidate("Use canonical JSONL for memory records."), ...match })).toBe(false);
  });
});
