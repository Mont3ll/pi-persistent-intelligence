import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch } from "../../src/patch";
import { loadActiveRecords, unsafeAddMemoryRecord } from "../../src/store";
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
    expect(state.generation).toBe(1); expect(state.last_transaction_id).toMatch(/^patch_mem_tx\.s[a-f0-9]{24}$/);
  });
  test("successful mutation leaves a completed durable transaction receipt", () => {
    const dir = root(); applyPatch(dir, addPatch("mem_receipt"), { now: "2026-09-28T08:31:00Z" });
    const transactionsDir = join(dir, "governance", "transactions"); expect(existsSync(transactionsDir)).toBe(true);
    const entries = readdirSync(transactionsDir); expect(entries).toHaveLength(1);
    const manifest = JSON.parse(readFileSync(join(transactionsDir, entries[0], "intent.json"), "utf8")) as { stage?: string; expected_generation?: number; next_generation?: number };
    expect(manifest.stage).toBe("complete"); expect(manifest.expected_generation).toBe(0); expect(manifest.next_generation).toBe(1);
  });
  test("two selections from the same patch have independent receipts and correct replay", () => {
    const dir = root();
    const patch: MemoryPatch = {
      ...addPatch("multi"), patch_id: "patch_same_minute_multi",
      ops: [
        { op_id: "op_001", op: "add", record: record("mem_first"),
          risk: "low", default_selected: false },
        { op_id: "op_002", op: "add", record: record("mem_second"),
          risk: "low", default_selected: false },
      ],
    };
    const first = applyPatch(dir, patch, {
      now: "2026-10-28T08:00:01Z", selectedOpIds: ["op_001"],
    });
    expect(first.applied_ops).toEqual(["op_001"]);
    expect(first.skipped_ops).toContainEqual(expect.objectContaining({
      op_id: "op_002", reason: "not_selected",
    }));
    expect(loadActiveRecords(dir).map((item) => item.id)).toEqual(["mem_first"]);

    const second = applyPatch(dir, patch, {
      now: "2026-10-28T08:00:02Z", selectedOpIds: ["op_002"],
    });
    expect(second.applied_ops).toEqual(["op_002"]);
    expect(second.skipped_ops).toContainEqual(expect.objectContaining({
      op_id: "op_001", reason: "not_selected",
    }));
    expect(loadActiveRecords(dir).map((item) => item.id).sort()).toEqual(["mem_first", "mem_second"]);
    const transactionsDir = join(dir, "governance", "transactions");
    const persisted = readdirSync(transactionsDir);
    expect(persisted).toHaveLength(2);
    const receiptsDir = join(dir, "patches", "receipts");
    const auditFiles = readdirSync(receiptsDir).sort();
    expect(auditFiles).toHaveLength(2);
    const audit = auditFiles.map((name) =>
      JSON.parse(readFileSync(join(receiptsDir, name), "utf8")) as MemoryPatch);
    expect(audit.map((item) => item.applied_ops.join(",")).sort()).toEqual(["op_001", "op_002"]);
    expect(audit.every((item) => item.patch_id === patch.patch_id)).toBe(true);
    // The root-level compatibility file is deliberately a latest-view, not
    // a complete archive. The two immutable receipts preserve both subsets.
    const latest = JSON.parse(readFileSync(join(dir, "patches", patch.patch_id + ".json"), "utf8")) as MemoryPatch;
    expect(latest.applied_ops).toEqual(["op_002"]);
    const originals = new Map(auditFiles.map((name) =>
      [name, readFileSync(join(receiptsDir, name), "utf8")]));
    expect(persisted.every((entry) => /^patch_same_minute_multi\.s[a-f0-9]{24}$/.test(entry))).toBe(true);

    const replayFirst = applyPatch(dir, patch, {
      now: "2026-10-28T08:00:03Z", selectedOpIds: ["op_001"],
    });
    const replaySecond = applyPatch(dir, patch, {
      now: "2026-10-28T08:00:04Z", selectedOpIds: ["op_002"],
    });
    expect(replayFirst.applied_ops).toEqual(["op_001"]);
    expect(replaySecond.applied_ops).toEqual(["op_002"]);
    expect(loadActiveRecords(dir)).toHaveLength(2);
    expect(readdirSync(receiptsDir).sort()).toEqual(auditFiles);
    for (const [name, contents] of originals) {
      expect(readFileSync(join(receiptsDir, name), "utf8")).toBe(contents);
    }
  });

  test("changed operation content under an unchanged external patch ID cannot reuse a receipt", () => {
    const dir = root();
    const original = addPatch("mem_original");
    const first = applyPatch(dir, original, { now: "2026-10-28T08:01:01Z" });
    expect(first.applied_ops).toEqual(["op_add"]);
    const altered = { ...original, ops: [{
      ...original.ops[0]!, record: record("mem_altered"),
    }] };
    const second = applyPatch(dir, altered, { now: "2026-10-28T08:01:02Z" });
    expect(second.applied_ops).toEqual(["op_add"]);
    expect(loadActiveRecords(dir).map((item) => item.id).sort())
      .toEqual(["mem_altered", "mem_original"]);
    expect(readdirSync(join(dir, "governance", "transactions"))).toHaveLength(2);
  });

  test("stale explicit generation precondition rejects before canonical mutation", () => {
    const dir = root(); unsafeAddMemoryRecord(dir, record("mem_existing", "before"));
    const patch: MemoryPatch = { patch_id: "patch_stale_generation", created_at: "2026-09-28T08:30:00Z", generated_by: "manual", mode: "supervised", summary: "stale generation", ops: [{ op_id: "op_update", op: "update", target_id: "mem_existing", updates: { statement: "after" }, risk: "low", default_selected: true }], status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [] };
    expect(() => applyPatch(dir, patch, { now: "2026-09-28T08:31:00Z", expectedGeneration: 7 })).toThrow(/generation/i);
  });
});
