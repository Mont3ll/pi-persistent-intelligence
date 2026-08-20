import { describe, expect, test } from "bun:test";
import { createMemoryKey, createMemoryKeyV2, getCandidateMemoryKey, getRecordMemoryKey, inferMemoryTopic, normalizeMemoryKeyInput } from "../../src/memory-key";
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

  test("creates explicitly versioned v2 keys", () => {
    expect(createMemoryKeyV2({
      profile_id: "legacy",
      scope_level: "global",
      scope_ref: "global",
      topic: "duplicate traversals",
      ruleType: "avoid_pattern",
    })).toBe("v2|legacy|global|global|duplicate-traversals|avoid-pattern");
  });

  test("infers memory topic from semantic tags before statement fallback", () => {
    expect(inferMemoryTopic({ tags: ["workflow", "memory-governance"], statement: "Use canonical JSONL" })).toBe("memory-governance");
    expect(inferMemoryTopic({ tags: ["workflow"], statement: "Use canonical JSONL as source" })).toBe("canonical-jsonl");
  });

  test("excludes capture, intent, lifecycle, applicability, and provenance tags from topics", () => {
    const cases = [
      { tags: ["capture"], statement: "Avoid duplicate traversals.", expected: "duplicate-traversals" },
      { tags: ["capture-backfill"], statement: "Avoid snake_case unless required.", expected: "snake-case-unless-required" },
      { tags: ["user_preference"], statement: "Avoid promotional language.", expected: "promotional-language" },
      { tags: ["workflow_playbook"], statement: "Run the release audit before publishing.", expected: "run-release-audit-before-publishing" },
      { tags: ["writing"], statement: "Prefer sentence case headings.", expected: "sentence-case-headings" },
      { tags: ["supersedes:mem_old", "capture"], statement: "Avoid duplicate traversals.", expected: "duplicate-traversals" },
      { tags: ["legacy-evidence-backfill"], statement: "Avoid duplicate traversals.", expected: "duplicate-traversals" },
    ];
    for (const item of cases) {
      expect(inferMemoryTopic({ tags: item.tags, statement: item.statement })).toBe(item.expected);
    }
    expect(inferMemoryTopic({
      tags: ["capture", "user_preference", "writing", "memory-governance"],
      statement: "Prefer explicit review.",
    })).toBe("memory-governance");
  });

  test("keeps distinct long avoid preferences distinct after the readable topic prefix", () => {
    const first = inferMemoryTopic({ tags: ["capture"], statement: "Avoid alpha beta gamma delta epsilon zeta red." });
    const second = inferMemoryTopic({ tags: ["capture"], statement: "Avoid alpha beta gamma delta epsilon zeta blue." });
    expect(first).not.toBe(second);
    expect(first).toMatch(/^alpha-beta-gamma-delta-epsilon-zeta-[a-f0-9]{12}$/);
    expect(second).toMatch(/^alpha-beta-gamma-delta-epsilon-zeta-[a-f0-9]{12}$/);
  });

  test("gives distinct captured avoid preferences distinct v2 keys", () => {
    const keys = [
      "Avoid duplicate traversals.",
      "Avoid snake_case unless the implementation requires it.",
    ].map((statement) => getRecordMemoryKey(record({
      scope: { type: "global" },
      profile_id: "legacy",
      tags: ["capture-backfill", "user_preference", "writing"],
      statement,
      ruleType: "avoid_pattern",
      normalized_key: undefined,
    })));
    expect(new Set(keys).size).toBe(2);
    expect(keys.every((key) => key.startsWith("v2|"))).toBe(true);
  });

  test("normalizes supported equivalent preferences to the same topic", () => {
    const first = inferMemoryTopic({ tags: ["capture", "user_preference", "writing"], statement: "Avoid em dashes entirely." });
    const second = inferMemoryTopic({ tags: ["capture", "user_preference", "writing"], statement: "Never use em-dashes when writing for me." });
    expect(first).toBe("em-dash");
    expect(second).toBe(first);
  });

  test("isolates v2 keys by profile, project, domain, and rule type", () => {
    const base = record({ normalized_key: undefined, tags: ["capture"], statement: "Avoid duplicate traversals.", scope: { type: "global" }, profile_id: "profile:a", ruleType: "avoid_pattern" });
    const key = getRecordMemoryKey(base);
    expect(getRecordMemoryKey({ ...base, profile_id: "profile:b" })).not.toBe(key);
    expect(getRecordMemoryKey({ ...base, scope: { type: "project", project: "one" } })).not.toBe(key);
    expect(getRecordMemoryKey({ ...base, scope: { type: "project", project: "two" } })).not.toBe(getRecordMemoryKey({ ...base, scope: { type: "project", project: "one" } }));
    expect(getRecordMemoryKey({ ...base, scope: { type: "domain", domains: ["health"] } })).not.toBe(getRecordMemoryKey({ ...base, scope: { type: "domain", domains: ["education"] } }));
    expect(getRecordMemoryKey({ ...base, ruleType: "prefer_pattern" })).not.toBe(key);
  });

  test("canonicalizes domain ordering", () => {
    const base = record({ normalized_key: undefined, tags: ["capture"], statement: "Avoid duplicate traversals.", profile_id: "profile:a", ruleType: "avoid_pattern" });
    expect(getRecordMemoryKey({ ...base, scope: { type: "domain", domains: ["writing", "health", "writing"] } }))
      .toBe(getRecordMemoryKey({ ...base, scope: { type: "domain", domains: ["health", "writing"] } }));
  });

  test("generates a v2 runtime key for legacy records without normalized_key", () => {
    const legacy = record({ normalized_key: undefined, profile_id: undefined });
    expect(getRecordMemoryKey(legacy)).toBe("v2|legacy|project|pi-persistent-intelligence|memory|workflow");
  });

  test("uses explicit normalized_key when present", () => {
    expect(getRecordMemoryKey(record({ normalized_key: "custom|key" }))).toBe("custom|key");
    expect(getCandidateMemoryKey(candidate({ normalized_key: "candidate|key" }))).toBe("candidate|key");
  });
});
