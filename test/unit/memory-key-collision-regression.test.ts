import { describe, expect, test } from "bun:test";
import {
  getCandidateMemoryKeys,
  getDerivedRecordMemoryKeyV2,
  getRecordMemoryKeys,
  inferMemoryTopic,
} from "../../src/memory-key";
import type { CaptureCandidate, MemoryRecord } from "../../src/types";

function record(statement: string, tag: string, normalizedKey?: string): MemoryRecord {
  return {
    id: `mem_${tag}_${statement.length}`,
    layer: "L2",
    scope: { type: "project", project: "pi-persistent-intelligence" },
    tags: [tag],
    statement,
    evidence: [{ type: "manual", ref: "fixture", note: "fixture" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-10-06",
    updated_at: "2026-10-06",
    review: { cadence_days: 30, next_review: "2026-11-05", change_condition: "If contradicted, revise." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    profile_id: "legacy",
    ...(normalizedKey ? { normalized_key: normalizedKey } : {}),
  };
}

function candidate(statement: string, tag: string, normalizedKey?: string): CaptureCandidate {
  return {
    id: `cap_${tag}_${statement.length}`,
    created_at: "2026-10-06T00:00:00.000Z",
    source: { type: "manual", ref: "fixture" },
    text: statement,
    tags: [tag],
    evidence_refs: ["fixture"],
    confidence: 0.9,
    status: "new",
    profile_id: "legacy",
    ...(normalizedKey ? { normalized_key: normalizedKey } : {}),
  };
}

const falseCollisionPairs = [
  {
    tag: "git",
    a: "Verify the exact merged SHA before advancing the pinned runtime.",
    b: "Use a fresh isolated worktree for verification before merging.",
  },
  {
    tag: "tooling",
    a: "Use Vercel only for deployment previews.",
    b: "Run long background jobs through the task worker.",
  },
  {
    tag: "payments",
    a: "Verify payment receipt signatures before marking orders paid.",
    b: "Only authorized operators may initiate account transfers.",
  },
  {
    tag: "git",
    a: "Pin runtime verification to the exact merged commit SHA.",
    b: "Require deployment artifacts to report the tested source SHA.",
  },
  {
    tag: "clerk",
    a: "Use Clerk identity fixtures when testing account recovery.",
    b: "Read Clerk session tokens only on the server.",
  },
] as const;

describe("statement-sensitive memory key identity", () => {
  for (const fixture of falseCollisionPairs) {
    test(`distinguishes separate ${fixture.tag} propositions`, () => {
      const first = record(fixture.a, fixture.tag);
      const second = record(fixture.b, fixture.tag);

      expect(inferMemoryTopic({ tags: first.tags, statement: first.statement }))
        .not.toBe(inferMemoryTopic({ tags: second.tags, statement: second.statement }));
      expect(getDerivedRecordMemoryKeyV2(first)).not.toBe(getDerivedRecordMemoryKeyV2(second));
    });
  }

  test("keeps exact duplicate propositions on the same derived identity", () => {
    const statement = "Verify the exact merged SHA before advancing the pinned runtime.";
    const first = record(statement, "git");
    const second = record(statement, "git");

    expect(getDerivedRecordMemoryKeyV2(first)).toBe(getDerivedRecordMemoryKeyV2(second));
  });

  test("retains stored structural v2 key while exposing the current derived key for records", () => {
    const current = record(
      "Verify the exact merged SHA before advancing the pinned runtime.",
      "git",
      "v2|legacy|project|pi-persistent-intelligence|git|memory",
    );

    const keys = getRecordMemoryKeys(current);
    expect(keys).toContain("v2|legacy|project|pi-persistent-intelligence|git|memory");
    expect(keys).toContain(getDerivedRecordMemoryKeyV2(current));
    expect(new Set(keys).size).toBe(2);
  });

  test("retains stored structural v2 key while exposing the current derived key for candidates", () => {
    const current = candidate(
      "Verify the exact merged SHA before advancing the pinned runtime.",
      "git",
      "v2|legacy|project|pi-persistent-intelligence|git|memory",
    );

    const keys = getCandidateMemoryKeys(current, { type: "project", project: "pi-persistent-intelligence" });
    expect(keys).toContain("v2|legacy|project|pi-persistent-intelligence|git|memory");
    expect(new Set(keys).size).toBe(2);
  });
});
