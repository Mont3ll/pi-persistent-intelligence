import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch } from "../../src/patch";
import { ensureMemoryDirs } from "../../src/paths";
import { loadAllRecords } from "../../src/store";
import type { MemoryPatch, MemoryRecord } from "../../src/types";

let roots: string[] = [];
function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-k3-recovery-")); roots.push(dir); return dir; }
afterEach(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); roots = []; });
function record(id: string): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["recovery"], statement: `recovery ${id}`, evidence: [{ type: "manual", ref: "ev1", note: "support" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-09-28", updated_at: "2026-09-28", review: { cadence_days: 30, next_review: "2026-10-28", change_condition: "If invalidated." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null }; }
function patch(id: string): MemoryPatch { return { patch_id: `patch_${id}`, created_at: "2026-09-28T09:00:00Z", generated_by: "manual", mode: "supervised", summary: "recovery contract", ops: [{ op_id: "op_add", op: "add", record: record(id), risk: "low", default_selected: true }], status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [] }; }

describe("K3 crash recovery and replay semantics", () => {
  test("replaying a completed patch is idempotent and returns the completed result", () => {
    const dir = root(); const request = patch("mem_replay");
    const first = applyPatch(dir, request, { now: "2026-09-28T09:01:00Z" });
    const second = applyPatch(dir, request, { now: "2026-09-28T09:02:00Z" });
    expect(first.status).toBe("applied"); expect(second.status).toBe("applied"); expect(second.applied_ops).toEqual(first.applied_ops);
    expect(loadAllRecords(dir).filter((item) => item.id === "mem_replay")).toHaveLength(1);
  });
  test("fault after durable commit intent does not silently commit live canonical state", () => {
    const dir = root(); const request = patch("mem_fault");
    expect(() => applyPatch(dir, request, { now: "2026-09-28T09:01:00Z", faultAfterStage: "intent_written" })).toThrow();
    expect(loadAllRecords(dir).some((item) => item.id === "mem_fault")).toBe(false);
    expect(existsSync(join(dir, "governance", "transactions"))).toBe(true);
  });
  test("malformed canonical JSONL is rejected before a new transaction can publish", () => {
    const dir = root(); const paths = ensureMemoryDirs(dir); writeFileSync(paths.memory.L2, '{"id":"truncated"\n', "utf8");
    expect(() => applyPatch(dir, patch("mem_after_corruption"), { now: "2026-09-28T09:01:00Z" })).toThrow();
    expect(readFileSync(paths.memory.L2, "utf8")).toBe('{"id":"truncated"\n');
    expect(existsSync(join(dir, "governance", "canonical-state.json"))).toBe(false);
  });
});
