import { describe, expect, test } from "bun:test";
import { createMemoryKey, getCandidateMemoryKey, getRecordMemoryKey, inferMemoryTopic, normalizeMemoryKeyInput } from "../../src/memory-key";
import type { CaptureCandidate, MemoryRecord } from "../../src/types";

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem_1",
    layer: "L2",
    scope: { type: "project", project: "Pi Persistent Intelligence" },
    tags: ["memory", "workflow"],
    statement: "Use canonical JSONL as the source of truth for structured data.",
    evidence: [{ type: "manual", ref: "x", note: "n" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-05-19",
    updated_at: "2026-05-19",
    review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "If contradicted, revise." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "workflow",
    profile_id: "project:pi-persistent-intelligence",
    ...overrides,
  };
}

function candidate(overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id: "cap_1",
    created_at: "2026-05-19T10:00:00.000Z",
    source: { type: "manual", ref: "daily" },
    text: "Use canonical JSONL as the source of truth for structured data.",
    tags: ["memory", "workflow"],
    evidence_refs: ["a", "b"],
    confidence: 0.9,
    status: "new",
    ruleType: "workflow",
    profile_id: "project:pi-persistent-intelligence",
    ...overrides,
  };
}

describe("memory key utilities", () => {
  test("normalizes key input deterministically", () => {
    expect(normalizeMemoryKeyInput(" Pi Persistent_Intelligence!! ")).toBe("pi-persistent-intelligence");
    expect(normalizeMemoryKeyInput("Use   JSONL\nNow")).toBe("use-jsonl-now");
  });

  test("creates deterministic normalized keys", () => {
    const a = createMemoryKey({ profile_id: "Project:PI", scope_level: "project", scope_ref: "Pi Persistent Intelligence", topic: "Canonical JSONL", ruleType: "workflow" });
    const b = createMemoryKey({ profile_id: "project pi", scope_level: "project", scope_ref: "pi-persistent-intelligence", topic: "canonical_jsonl", ruleType: "workflow" });
    expect(a).toBe(b);
    expect(a).toBe("project-pi|project|pi-persistent-intelligence|canonical-jsonl|workflow");
  });

  test("infers memory topic from tags before statement fallback", () => {
    expect(inferMemoryTopic({ tags: ["workflow", "memory-governance"], statement: "Use canonical JSONL" })).toBe("memory-governance");
    expect(inferMemoryTopic({ tags: ["workflow"], statement: "Use canonical JSONL as source" })).toBe("canonical-jsonl");
  });

  test("generates runtime key for legacy records without normalized_key", () => {
    const legacy = record({ normalized_key: undefined, profile_id: undefined });
    expect(getRecordMemoryKey(legacy)).toBe("legacy|project|pi-persistent-intelligence|memory|workflow");
  });

  test("uses explicit normalized_key when present", () => {
    expect(getRecordMemoryKey(record({ normalized_key: "custom|key" }))).toBe("custom|key");
    expect(getCandidateMemoryKey(candidate({ normalized_key: "candidate|key" }))).toBe("candidate|key");
  });
});
