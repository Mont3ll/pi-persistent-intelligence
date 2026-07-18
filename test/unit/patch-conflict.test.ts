import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord, loadAllRecords } from "../../src/store";
import { appendDeletionTombstone, createDeletionTombstone } from "../../src/tombstones";
import { appendEvidenceRecord } from "../../src/evidence";
import { applyPatch } from "../../src/patch";
import type { MemoryPatch, MemoryRecord, PatchOp, PatchSkipReason } from "../../src/types";

function root(): string { const r = mkdtempSync(join(tmpdir(), "pi-patch-conflict-")); ensureMemoryDirs(r); return r; }
function rec(id: string, opts: Partial<MemoryRecord> = {}): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["test"], statement: "Use bun.", evidence: [{ type: "manual", ref: "ev1", note: "support" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-05-01", updated_at: "2026-05-01", review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If contradicted." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null, ...opts }; }
function patch(op: PatchOp): MemoryPatch { return { patch_id: `patch_${op.op_id}`, created_at: "2026-05-01T00:00:00Z", generated_by: "manual", mode: "auto", summary: "test", ops: [op], status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [] }; }
function expectSkipped(result: MemoryPatch, reason: PatchSkipReason, detail: string) {
  expect(result.applied_ops).toEqual([]);
  expect(result.status).toBe("rejected_at_apply");
  expect(result.skipped_ops).toEqual([{
    op_id: "op1",
    candidate_id: "cap1",
    reason,
    detail,
  }]);
}

describe("patch apply conflict hardening", () => {
  test("stale add explains duplicate active id", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem1"));
    const result = applyPatch(r, patch({ op_id: "op1", candidate_id: "cap1", op: "add", record: rec("mem1"), risk: "low", default_selected: true }), { now: "2026-05-02T00:00:00Z" });
    expectSkipped(result, "duplicate_id", "Record mem1 already exists in canonical memory.");
    expect(loadAllRecords(r).filter((m) => m.id === "mem1")).toHaveLength(1);
    rmSync(r, { recursive: true, force: true });
  });

  test("stale update explains terminal target", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem1", { status: "deleted" }));
    const result = applyPatch(r, patch({ op_id: "op1", candidate_id: "cap1", op: "update", target_id: "mem1", updates: { statement: "changed" }, risk: "low", default_selected: true }), { now: "2026-05-02T00:00:00Z" });
    expectSkipped(result, "target_terminal", "Target mem1 has terminal status deleted.");
    rmSync(r, { recursive: true, force: true });
  });

  test("missing update target is distinguished from terminal target", () => {
    const r = root();
    const result = applyPatch(r, patch({ op_id: "op1", candidate_id: "cap1", op: "update", target_id: "missing", updates: { statement: "changed" }, risk: "low", default_selected: true }), { now: "2026-05-02T00:00:00Z" });
    expectSkipped(result, "missing_target", "Target missing does not exist.");
    rmSync(r, { recursive: true, force: true });
  });

  test("stale supersede explains terminal target", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("old", { status: "superseded", superseded_by: ["newer"] }));
    const result = applyPatch(r, patch({ op_id: "op1", candidate_id: "cap1", op: "supersede", target_id: "old", to_record: rec("new"), risk: "medium", default_selected: true }), { now: "2026-05-02T00:00:00Z" });
    expectSkipped(result, "target_terminal", "Target old has terminal status superseded.");
    rmSync(r, { recursive: true, force: true });
  });

  test("self supersession is rejected explicitly", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem1"));
    const result = applyPatch(r, patch({ op_id: "op1", candidate_id: "cap1", op: "supersede", target_id: "mem1", to_record: rec("mem1"), risk: "high", default_selected: true }), { now: "2026-05-02T00:00:00Z" });
    expectSkipped(result, "self_supersession", "A record cannot supersede itself: mem1.");
    rmSync(r, { recursive: true, force: true });
  });

  test("supersede replacement id conflict is explained", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("old"));
    unsafeAddMemoryRecord(r, rec("new"));
    const result = applyPatch(r, patch({ op_id: "op1", candidate_id: "cap1", op: "supersede", target_id: "old", to_record: rec("new"), risk: "medium", default_selected: true }), { now: "2026-05-02T00:00:00Z" });
    expectSkipped(result, "replacement_id_conflict", "Replacement record new already exists.");
    rmSync(r, { recursive: true, force: true });
  });

  test("delete explains an existing tombstone", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem1"));
    appendDeletionTombstone(r, createDeletionTombstone({ deleted_record_id: "mem1", deletion_mode: "audit_preserving", deletion_reason: "invalid", now: "2026-05-01T00:00:00Z" }));
    const result = applyPatch(r, patch({ op_id: "op1", candidate_id: "cap1", op: "delete", target_id: "mem1", risk: "low", default_selected: true }), { now: "2026-05-02T00:00:00Z" });
    expectSkipped(result, "tombstoned", "Target mem1 is tombstoned.");
    rmSync(r, { recursive: true, force: true });
  });

  test("invalidated evidence is explained", () => {
    const r = root();
    appendEvidenceRecord(r, { id: "ev1", resource_id: "u", profile_id: "p", created_at: "2026-05-01T00:00:00Z", source_kind: "conversation", source_summary: "deleted", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: [], redaction_status: "deleted" });
    const result = applyPatch(r, patch({ op_id: "op1", candidate_id: "cap1", op: "add", record: rec("mem1"), risk: "low", default_selected: true }), { now: "2026-05-02T00:00:00Z" });
    expectSkipped(result, "invalidated_evidence", "Operation op1 references redacted or deleted evidence.");
    rmSync(r, { recursive: true, force: true });
  });

  test("unselected operation is distinguished from an inapplicable operation", () => {
    const r = root();
    const result = applyPatch(r, patch({ op_id: "op1", candidate_id: "cap1", op: "add", record: rec("mem1"), risk: "low", default_selected: false }), { now: "2026-05-02T00:00:00Z" });
    expectSkipped(result, "not_selected", "Operation op1 was not selected for application.");
    rmSync(r, { recursive: true, force: true });
  });

  test("malformed operation is explained", () => {
    const r = root();
    const result = applyPatch(r, patch({ op_id: "op1", candidate_id: "cap1", op: "add", risk: "low", default_selected: true }), { now: "2026-05-02T00:00:00Z" });
    expectSkipped(result, "malformed_operation", "Add operation op1 is missing its record.");
    rmSync(r, { recursive: true, force: true });
  });

  test("mixed outcomes remain partially applied", () => {
    const r = root();
    const twoOps: MemoryPatch = {
      ...patch({ op_id: "op1", candidate_id: "cap1", op: "add", record: rec("mem1"), risk: "low", default_selected: true }),
      ops: [
        { op_id: "op1", candidate_id: "cap1", op: "add", record: rec("mem1"), risk: "low", default_selected: true },
        { op_id: "op2", candidate_id: "cap2", op: "add", record: rec("mem2"), risk: "low", default_selected: false },
      ],
    };
    const result = applyPatch(r, twoOps, { now: "2026-05-02T00:00:00Z" });
    expect(result.status).toBe("partially_applied");
    expect(result.applied_ops).toEqual(["op1"]);
    expect(result.skipped_ops).toEqual([{
      op_id: "op2", candidate_id: "cap2", reason: "not_selected", detail: "Operation op2 was not selected for application.",
    }]);
    rmSync(r, { recursive: true, force: true });
  });
});
