import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch } from "../../src/patch";
import { resolvePaths } from "../../src/paths";
import { loadAllRecords } from "../../src/store";
import type { MemoryPatch, MemoryRecord } from "../../src/types";

let roots: string[] = [];
function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-k4-concurrency-")); roots.push(dir); return dir; }
afterEach(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); roots = []; });
function record(id: string): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["concurrency"], statement: `writer ${id}`, evidence: [{ type: "manual", ref: "ev1", note: "support" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-09-28", updated_at: "2026-09-28", review: { cadence_days: 30, next_review: "2026-10-28", change_condition: "If invalidated." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null }; }
function patch(id: string): MemoryPatch { return { patch_id: `patch_${id}`, created_at: "2026-09-28T09:30:00Z", generated_by: "manual", mode: "supervised", summary: "concurrent writer contract", ops: [{ op_id: "op_add", op: "add", record: record(id), risk: "low", default_selected: true }], status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [] }; }

describe("K4 concurrent writer safety", () => {
  test("memory paths expose an explicit governance writer lock", () => {
    const dir = root();
    expect(resolvePaths(dir).governance.writerLock).toBe(join(dir, "governance", "writer.lock"));
  });
  test("two writers using the same observed generation cannot both commit", () => {
    const dir = root();
    const first = applyPatch(dir, patch("mem_writer_a"), { now: "2026-09-28T09:31:00Z", expectedGeneration: 0 });
    expect(first.status).toBe("applied");
    expect(() => applyPatch(dir, patch("mem_writer_b"), { now: "2026-09-28T09:32:00Z", expectedGeneration: 0 })).toThrow(/generation|stale/i);
    expect(loadAllRecords(dir).some((item) => item.id === "mem_writer_a")).toBe(true);
    expect(loadAllRecords(dir).some((item) => item.id === "mem_writer_b")).toBe(false);
    expect(existsSync(resolvePaths(dir).governance.writerLock)).toBe(false);
  });
});
