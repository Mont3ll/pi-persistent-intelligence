import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch } from "../../src/patch";
import { unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryPatch, MemoryRecord } from "../../src/types";

let roots: string[] = [];
function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-k2-transaction-")); roots.push(dir); return dir; }
afterEach(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); roots = []; });
function record(id: string, statement = `statement ${id}`): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["transaction"], statement, evidence: [{ type: "manual", ref: "ev1", note: "support" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-09-28", updated_at: "2026-09-28", review: { cadence_days: 30, next_review: "2026-10-28", change_condition: "If invalidated." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null }; }
function addPatch(id: string): MemoryPatch { return { patch_id: `patch_${id}`, created_at: "2026-09-28T08:30:00Z", generated_by: "manual", mode: "supervised", summary: "transaction contract", ops: [{ op_id: "op_add", op: "add", record: record(id), risk: "low", default_selected: true }], status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [] }; }

describe("K2 governance transaction envelope", () => {
  test("successful governed mutation publishes one canonical generation", () => {
    const dir = root(); const result = applyPatch(dir, addPatch("mem_tx"), { now: "2026-09-28T08:31:00Z" }); expect(result.status).toBe("applied");
    const stateFile = join(dir, "governance", "canonical-state.json"); expect(existsSync(stateFile)).toBe(true);
    const state = JSON.parse(readFileSync(stateFile, "utf8")) as { generation?: number; last_transaction_id?: string };
    expect(state.generation).toBe(1); expect(state.last_transaction_id).toBe("patch_mem_tx");
  });
  test("successful mutation leaves a completed durable transaction receipt", () => {
    const dir = root(); applyPatch(dir, addPatch("mem_receipt"), { now: "2026-09-28T08:31:00Z" });
    const transactionsDir = join(dir, "governance", "transactions"); expect(existsSync(transactionsDir)).toBe(true);
    const entries = readdirSync(transactionsDir); expect(entries).toHaveLength(1);
    const manifest = JSON.parse(readFileSync(join(transactionsDir, entries[0], "intent.json"), "utf8")) as { stage?: string; expected_generation?: number; next_generation?: number };
    expect(manifest.stage).toBe("complete"); expect(manifest.expected_generation).toBe(0); expect(manifest.next_generation).toBe(1);
  });
  test("stale explicit generation precondition rejects before canonical mutation", () => {
    const dir = root(); unsafeAddMemoryRecord(dir, record("mem_existing", "before"));
    const patch: MemoryPatch = { patch_id: "patch_stale_generation", created_at: "2026-09-28T08:30:00Z", generated_by: "manual", mode: "supervised", summary: "stale generation", ops: [{ op_id: "op_update", op: "update", target_id: "mem_existing", updates: { statement: "after" }, risk: "low", default_selected: true }], status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [] };
    expect(() => applyPatch(dir, patch, { now: "2026-09-28T08:31:00Z", expectedGeneration: 7 })).toThrow(/generation/i);
  });
});
