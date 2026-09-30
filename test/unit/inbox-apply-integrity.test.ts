import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendOrReinforceCandidate } from "../../src/capture-recurrence";
import { curateInbox } from "../../src/curator";
import { listCandidates, replaceCandidates, updateCandidateStatus } from "../../src/inbox";
import { unsafeAddMemoryRecord as addMemoryRecord } from "../../src/store";
import type { CaptureCandidate, MemoryRecord } from "../../src/types";

let roots: string[] = [];
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-inbox-integrity-"));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  roots = [];
});

function candidate(overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id: "cap_same",
    created_at: "2026-09-30T00:00:00Z",
    source: { type: "direct_user_instruction", ref: "session:s1:turn:t1" },
    text: "Prefer concise tables for status reports",
    tags: ["capture", "user_preference"],
    evidence_refs: ["ev_1", "ev_2"],
    confidence: 0.9,
    status: "new",
    capture_intent: "user_preference",
    normalized_preference_key: "user_preference:concise tables status reports",
    scope_targets: [{ type: "project", project: "pi", confidence: 0.9, basis: ["test_fixture"] }],
    ...overrides,
  };
}

describe("inbox apply integrity", () => {
  test("status updates only matching NEW occurrences when an older terminal row shares the same id", () => {
    const dir = root();
    replaceCandidates(dir, [
      candidate({ created_at: "2026-09-29T00:00:00Z", status: "patched" }),
      candidate({ created_at: "2026-09-30T00:00:00Z", status: "new" }),
    ]);

    updateCandidateStatus(dir, "cap_same", "rejected");

    const rows = listCandidates(dir);
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("patched");
    expect(rows[1].status).toBe("rejected");
  });

  test("exact candidate-id recapture does not append another logical occurrence after terminal processing", () => {
    const dir = root();
    replaceCandidates(dir, [candidate({ status: "patched" })]);

    const result = appendOrReinforceCandidate(dir, candidate({
      created_at: "2026-09-30T01:00:00Z",
      source: { type: "direct_user_instruction", ref: "session:s1:turn:t2" },
      evidence_refs: ["ev_3"],
      evidence_ids: ["ev_3"],
    }));

    expect(result.action).toBe("reinforced");
    expect(listCandidates(dir)).toHaveLength(1);
    expect(listCandidates(dir)[0].status).toBe("patched");
  });

  test("repeated negative constraints do not supersede an already-negative memory", () => {
    const dir = root();
    addMemoryRecord(dir, {
      id: "mem_negative",
      layer: "L2",
      scope: { type: "project", project: "pi" },
      tags: ["capture", "testing", "implementation"],
      statement: "Do not modify or push the remote branch during independent verification",
      evidence: [{ type: "manual", ref: "old", note: "old" }],
      confidence: 0.9,
      stability: "semi-stable",
      created_at: "2026-09-01",
      updated_at: "2026-09-01",
      review: { cadence_days: 30, next_review: "2026-10-01", change_condition: "If contradicted, revise." },
      status: "active",
      supersedes: [],
      superseded_by: [],
      vault_ref: null,
    });
    replaceCandidates(dir, [candidate({
      id: "cap_repeated_negative",
      text: "Do not modify or push the remote branch; run local verification only",
      tags: ["capture", "testing", "implementation"],
      normalized_preference_key: "behavior_correction:local verification",
    })]);

    const patch = curateInbox(dir, { now: "2026-09-30T02:00:00Z", mode: "propose", minEvidenceCount: 1 });

    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0].op).toBe("add");
  });

  test("generic capture-tag overlap cannot by itself turn an unrelated negative instruction into a supersession", () => {
    const dir = root();
    const existing: MemoryRecord = {
      id: "mem_existing",
      layer: "L2",
      scope: { type: "project", project: "pi" },
      tags: ["capture", "user_preference"],
      statement: "Prefer concise tables for project status reports",
      evidence: [{ type: "manual", ref: "old", note: "old" }],
      confidence: 0.9,
      stability: "semi-stable",
      created_at: "2026-09-01",
      updated_at: "2026-09-01",
      review: { cadence_days: 30, next_review: "2026-10-01", change_condition: "If contradicted, revise." },
      status: "active",
      supersedes: [],
      superseded_by: [],
      vault_ref: null,
    };
    addMemoryRecord(dir, existing);
    replaceCandidates(dir, [candidate({
      id: "cap_unrelated",
      text: "Do not include release procedures in these reports",
      normalized_preference_key: "user_preference:include release procedures reports",
    })]);

    const patch = curateInbox(dir, { now: "2026-09-30T02:00:00Z", mode: "propose", minEvidenceCount: 1 });

    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0].op).toBe("add");
    expect(patch.ops[0].risk).toBe("low");
  });
});
