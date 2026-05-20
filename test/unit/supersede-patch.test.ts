import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unsafeAddMemoryRecord as addMemoryRecord, loadAllRecords } from "../../src/store";
import { applyPatch } from "../../src/patch";
import type { MemoryPatch, MemoryRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-pi-super-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function rec(id: string, statement = "old"): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["workflow"], statement, evidence: [{ type: "manual", ref: "x", note: "n" }], confidence: 0.8, stability: "semi-stable", created_at: "2026-05-09", updated_at: "2026-05-09", review: { cadence_days: 30, next_review: "2026-06-08", change_condition: "If contradicted, revise." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null }; }

describe("supersede patch", () => {
  test("marks old record superseded and adds replacement with backlinks", () => {
    const dir = root();
    addMemoryRecord(dir, rec("mem_old"));
    const patch: MemoryPatch = { patch_id: "patch_sup", created_at: "2026-05-09T00:00:00Z", generated_by: "manual", mode: "auto", summary: "sup", ops: [{ op_id: "op_001", op: "supersede", target_id: "mem_old", to_record: rec("mem_new", "new"), risk: "medium", default_selected: true }], status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [] };
    applyPatch(dir, patch, { now: "2026-05-09T00:00:00Z" });
    const records = loadAllRecords(dir);
    expect(records.find((r) => r.id === "mem_old")?.status).toBe("superseded");
    expect(records.find((r) => r.id === "mem_old")?.superseded_by).toEqual(["mem_new"]);
    expect(records.find((r) => r.id === "mem_new")?.supersedes).toEqual(["mem_old"]);
  });
});
