import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord, loadAllRecords } from "../../src/store";
import { appendDeletionTombstone, createDeletionTombstone } from "../../src/tombstones";
import { applyPatch } from "../../src/patch";
import type { MemoryPatch, MemoryRecord } from "../../src/types";

function root(): string { const r = mkdtempSync(join(tmpdir(), "pi-patch-conflict-")); ensureMemoryDirs(r); return r; }
function rec(id: string, opts: Partial<MemoryRecord> = {}): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["test"], statement: "Use bun.", evidence: [{ type: "manual", ref: "ev1", note: "support" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-05-01", updated_at: "2026-05-01", review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If contradicted." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null, ...opts }; }
function patch(op: MemoryPatch["ops"][number]): MemoryPatch { return { patch_id: `patch_${op.op_id}`, created_at: "2026-05-01T00:00:00Z", generated_by: "manual", mode: "auto", summary: "test", ops: [op], status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [] }; }

describe("patch apply conflict hardening", () => {
  test("stale add blocked by duplicate active id", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem1"));
    const result = applyPatch(r, patch({ op_id: "op1", op: "add", record: rec("mem1"), risk: "low", default_selected: true }), { now: "2026-05-02T00:00:00Z" });
    expect(result.applied_ops).toEqual([]);
    expect(result.skipped_ops).toContain("op1");
    expect(loadAllRecords(r).filter((m) => m.id === "mem1")).toHaveLength(1);
    rmSync(r, { recursive: true, force: true });
  });

  test("stale update skipped if target deleted", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem1", { status: "deleted" }));
    const result = applyPatch(r, patch({ op_id: "op1", op: "update", target_id: "mem1", updates: { statement: "changed" }, risk: "low", default_selected: true }), { now: "2026-05-02T00:00:00Z" });
    expect(result.applied_ops).toEqual([]);
    expect(result.skipped_ops).toContain("op1");
    rmSync(r, { recursive: true, force: true });
  });

  test("stale supersede skipped if target already superseded", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("old", { status: "superseded", superseded_by: ["newer"] }));
    const result = applyPatch(r, patch({ op_id: "op1", op: "supersede", target_id: "old", to_record: rec("new"), risk: "medium", default_selected: true }), { now: "2026-05-02T00:00:00Z" });
    expect(result.applied_ops).toEqual([]);
    expect(result.skipped_ops).toContain("op1");
    rmSync(r, { recursive: true, force: true });
  });

  test("delete is idempotently skipped if target already tombstoned", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem1"));
    appendDeletionTombstone(r, createDeletionTombstone({ deleted_record_id: "mem1", deletion_mode: "audit_preserving", deletion_reason: "invalid", now: "2026-05-01T00:00:00Z" }));
    const result = applyPatch(r, patch({ op_id: "op1", op: "delete", target_id: "mem1", risk: "low", default_selected: true }), { now: "2026-05-02T00:00:00Z" });
    expect(result.applied_ops).toEqual([]);
    expect(result.skipped_ops).toContain("op1");
    rmSync(r, { recursive: true, force: true });
  });
});
