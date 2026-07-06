import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCandidate, listCandidates } from "../../src/inbox";
import { applyPatch } from "../../src/patch";
import { renderMemoryMarkdown } from "../../src/render";
import { unsafeAddMemoryRecord, loadAllRecords } from "../../src/store";
import type { CaptureCandidate, MemoryPatch, MemoryRecord, PatchOp } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-patch-audit-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function record(id: string, statement = "Use npm test for verification.", overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["testing", "workflow"],
    statement,
    evidence: [{ type: "manual", ref: `ev_${id}`, note: "supports audit fixture" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-07-01",
    updated_at: "2026-07-01",
    review: { cadence_days: 30, next_review: "2026-08-01", change_condition: "If verification workflow changes." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...overrides,
  };
}

function patch(op: PatchOp): MemoryPatch {
  return {
    patch_id: `patch_${op.op_id}`,
    created_at: "2026-07-04T00:00:00.000Z",
    generated_by: "manual",
    mode: "supervised",
    summary: "audit patch",
    ops: [op],
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}

function candidate(overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id: "cap_reject_me",
    created_at: "2026-07-04T00:00:00.000Z",
    source: { type: "manual", ref: "audit" },
    text: "Generated low-trust content should not become memory.",
    tags: ["generated"],
    evidence_refs: ["audit"],
    confidence: 0.3,
    status: "new",
    ...overrides,
  };
}

describe("patch lifecycle audit invariants", () => {
  test("reject_candidate patch marks the inbox candidate rejected without mutating memory", () => {
    const dir = root();
    appendCandidate(dir, candidate());

    const result = applyPatch(dir, patch({ op_id: "op_reject", op: "reject_candidate", candidate_id: "cap_reject_me", reason: "Generated content is low trust.", risk: "low", default_selected: true }), { now: "2026-07-04T01:00:00.000Z" });

    expect(result.applied_ops).toEqual(["op_reject"]);
    expect(result.skipped_ops).toEqual([]);
    expect(listCandidates(dir).find((item) => item.id === "cap_reject_me")?.status).toBe("rejected");
    expect(loadAllRecords(dir)).toHaveLength(0);
    expect(readFileSync(join(dir, "patches", "patch_op_reject.json"), "utf-8")).toContain("reject_candidate");
  });

  test("supersede patch writes explicit temporal invalidation fields to canonical JSONL", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record("mem_a", "Use npm test for verification.", { created_at: "2026-07-01", updated_at: "2026-07-01" }));

    applyPatch(dir, patch({ op_id: "op_sup", op: "supersede", target_id: "mem_a", to_record: record("mem_b", "Use bun test for verification.", { created_at: "2026-07-04", updated_at: "2026-07-04" }), risk: "medium", default_selected: true }), { now: "2026-07-04T01:02:03.000Z" });

    const oldRecord = loadAllRecords(dir).find((item) => item.id === "mem_a");
    const newRecord = loadAllRecords(dir).find((item) => item.id === "mem_b");
    expect(oldRecord?.status).toBe("superseded");
    expect(oldRecord?.valid_to).toBe("2026-07-04");
    expect(oldRecord?.invalidated_by).toBe("mem_b");
    expect(oldRecord?.validity_reason).toContain("Superseded");
    expect(newRecord?.valid_from).toBe("2026-07-04");
    expect(newRecord?.supersedes).toEqual(["mem_a"]);
  });

  test("rendered markdown projection excludes superseded records from active memory view", () => {
    const markdown = renderMemoryMarkdown([
      record("mem_old", "Use npm test for verification.", { status: "superseded", superseded_by: ["mem_new"] }),
      record("mem_new", "Use bun test for verification.", { supersedes: ["mem_old"] }),
    ]);

    expect(markdown).not.toContain("Use npm test for verification.");
    expect(markdown).toContain("Use bun test for verification.");
  });
});
