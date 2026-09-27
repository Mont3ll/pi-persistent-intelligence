import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCandidate, listCandidates } from "../../src/inbox";
import { curateInbox } from "../../src/curator";
import { ensureMemoryDirs } from "../../src/paths";
import { applyPatch } from "../../src/patch";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import type { CaptureCandidate, MemoryPatch, MemoryRecord, PatchOp } from "../../src/types";

let roots: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-patch-lifecycle-"));
  roots.push(dir);
  ensureMemoryDirs(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  roots = [];
});

function record(id: string, options: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["workflow"],
    statement: `Guidance for ${id}`,
    evidence: [{ type: "manual", ref: "ev1", note: "support" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-05-01",
    updated_at: "2026-05-01",
    review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...options,
  };
}

function candidate(id: string, options: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id,
    created_at: "2026-05-09T00:00:00Z",
    source: { type: "manual", ref: "daily" },
    text: `Candidate ${id}`,
    tags: ["workflow"],
    evidence_refs: ["a", "b"],
    confidence: 0.9,
    status: "new",
    ...options,
  };
}

function patch(id: string, op: PatchOp): MemoryPatch {
  return {
    patch_id: id,
    created_at: "2026-05-10T00:00:00Z",
    generated_by: "manual",
    mode: "propose",
    summary: "patch lifecycle completeness test",
    ops: [op],
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}

describe("patch lifecycle completeness", () => {
  test("reject_candidate durably rejects a candidate and is idempotent", () => {
    const dir = root();
    appendCandidate(dir, candidate("cap_reject"));
    const rejection = patch("patch_reject", {
      op_id: "op_reject",
      op: "reject_candidate",
      candidate_id: "cap_reject",
      risk: "low",
      default_selected: true,
    });

    const first = applyPatch(dir, rejection, { now: "2026-05-10T00:00:00Z" });
    expect(first.applied_ops).toEqual(["op_reject"]);
    expect(listCandidates(dir).find((item) => item.id === "cap_reject")?.status).toBe("rejected");

    const second = applyPatch(dir, rejection, { now: "2026-05-11T00:00:00Z" });
    expect(second.applied_ops).toEqual(["op_reject"]);
    expect(second.skipped_ops).toEqual([]);
    expect(listCandidates(dir).find((item) => item.id === "cap_reject")?.status).toBe("rejected");
  });

  test("reject_candidate explicitly rejects a missing candidate target", () => {
    const dir = root();
    const result = applyPatch(dir, patch("patch_missing_candidate", {
      op_id: "op_reject",
      op: "reject_candidate",
      candidate_id: "cap_missing",
      risk: "low",
      default_selected: true,
    }), { now: "2026-05-10T00:00:00Z" });

    expect(result.applied_ops).toEqual([]);
    expect(result.status).toBe("rejected_at_apply");
    expect(result.skipped_ops).toEqual([expect.objectContaining({
      op_id: "op_reject",
      candidate_id: "cap_missing",
      reason: "missing_candidate",
    })]);
  });

  test("supersede records temporal validity and repeated application is explicitly rejected", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record("mem_old", { valid_from: "2026-05-01" }));
    const supersede = patch("patch_supersede", {
      op_id: "op_supersede",
      op: "supersede",
      target_id: "mem_old",
      to_record: record("mem_new", { created_at: "2026-05-09", updated_at: "2026-05-09" }),
      risk: "high",
      default_selected: true,
    });

    const first = applyPatch(dir, supersede, { now: "2026-05-10T00:00:00Z" });
    expect(first.applied_ops).toEqual(["op_supersede"]);

    const records = loadAllRecords(dir);
    const oldRecord = records.find((item) => item.id === "mem_old");
    const replacement = records.find((item) => item.id === "mem_new");
    expect(oldRecord?.status).toBe("superseded");
    expect(oldRecord?.valid_to).toBe("2026-05-09");
    expect(oldRecord?.invalidated_by).toBe("mem_new");
    expect(oldRecord?.validity_reason).toBe("Superseded by mem_new.");
    expect(replacement?.valid_from).toBe("2026-05-09");

    const second = applyPatch(dir, supersede, { now: "2026-05-11T00:00:00Z" });
    expect(second.applied_ops).toEqual([]);
    expect(second.status).toBe("rejected_at_apply");
    expect(second.skipped_ops).toEqual([expect.objectContaining({
      op_id: "op_supersede",
      reason: "target_terminal",
    })]);
  });

  test("curator classifies supersede operations as high risk", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record("mem_old"));
    appendCandidate(dir, candidate("cap_new", {
      text: "Use reviewed patch files instead of direct edits",
      tags: ["workflow", "supersedes:mem_old"],
    }));

    const curated = curateInbox(dir, { now: "2026-05-10T00:00:00Z", mode: "propose" });
    expect(curated.ops).toHaveLength(1);
    expect(curated.ops[0].op).toBe("supersede");
    expect(curated.ops[0].risk).toBe("high");
    expect(curated.ops[0].default_selected).toBe(false);
  });
});
