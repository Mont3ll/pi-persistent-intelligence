import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { applyPatch } from "../../src/patch";
import { unsafeAddMemoryRecord } from "../../src/store";
import { MemoryFtsIndex } from "../../src/search/fts";
import { syncFtsIndex } from "../../src/retriever";
import { applyPatchAndSync } from "../../index";
import { extractHardRules } from "../../src/rules";
import { readRecentRuntimeEvents } from "../../src/runtime-events";
import { loadAllRecords } from "../../src/store";
import type { MemoryPatch, MemoryRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-sync-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem_target",
    layer: "L2",
    scope: { type: "global" },
    tags: ["testing", "correction"],
    statement: "Never expose the secret token abc123.",
    evidence: [{ type: "manual", ref: "x", note: "n" }],
    confidence: 0.95,
    stability: "semi-stable",
    created_at: "2026-05-19",
    updated_at: "2026-05-19",
    review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "avoid_pattern",
    ...overrides,
  };
}

function addPatch(): MemoryPatch {
  return {
    patch_id: "patch_add_sync_check",
    created_at: "2026-05-19T10:00:00.000Z",
    generated_by: "manual",
    mode: "propose",
    summary: "add sync check",
    ops: [{ op_id: "op_add", op: "add", record: record({ id: "mem_added_sync", statement: "Use FTS-aware sync diagnostics." }), risk: "low", default_selected: true }],
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}

function deletePatch(mode: "audit_preserving" | "privacy_purge"): MemoryPatch {
  return {
    patch_id: `patch_del_${mode}`,
    created_at: "2026-05-19T10:00:00.000Z",
    generated_by: "manual",
    mode: "propose",
    summary: `delete ${mode}`,
    ops: [{ op_id: "op_001", op: "delete", target_id: "mem_target", deletion_mode: mode, deletion_reason: mode === "privacy_purge" ? "privacy_sensitive" : "invalid", reason: "test", risk: "high", default_selected: true }],
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}

describe("patch sync integration", () => {
  test("applyPatchAndSync removes deleted memory from FTS — audit_preserving", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const fts = new MemoryFtsIndex(join(dir, "search", "fts.db"));
    syncFtsIndex(dir, fts);
    expect(fts.search("abc123", 5)).toHaveLength(1);

    applyPatchAndSync(dir, deletePatch("audit_preserving"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" }, fts);

    expect(fts.search("abc123", 5)).toHaveLength(0);
    expect(extractHardRules(loadAllRecords(dir))).toHaveLength(0);
    fts.close();
  });

  test("applyPatchAndSync removes purged memory from FTS — privacy_purge", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const fts = new MemoryFtsIndex(join(dir, "search", "fts.db"));
    syncFtsIndex(dir, fts);
    expect(fts.search("abc123", 5)).toHaveLength(1);

    applyPatchAndSync(dir, deletePatch("privacy_purge"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" }, fts);

    const results = fts.search("abc123", 5);
    expect(results).toHaveLength(0);
    const purged = loadAllRecords(dir).find((r) => r.id === "mem_target");
    expect(purged?.statement).toBe("[deleted]");
    fts.close();
  });

  test("applyPatch() low-level without sync leaves stale FTS until manual sync — documented behavior", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const fts = new MemoryFtsIndex(join(dir, "search", "fts.db"));
    syncFtsIndex(dir, fts);
    expect(fts.search("abc123", 5)).toHaveLength(1);

    applyPatch(dir, deletePatch("audit_preserving"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });
    // FTS not yet synced — stale result expected; caller must sync
    expect(fts.search("abc123", 5)).toHaveLength(1);

    syncFtsIndex(dir, fts);
    expect(fts.search("abc123", 5)).toHaveLength(0);
    fts.close();
  });

  test("applyPatchAndSync runs FTS-aware diagnostics after sync", () => {
    const dir = root();
    const fts = { isAvailable: true, sync: () => {}, close: () => {}, search: (query: string) => query === "__post_mutation_probe__" ? [] : [{ id: "wrong", statement: "wrong", layer: "L2", confidence: 0.9, score: 1 }] } as unknown as MemoryFtsIndex;

    applyPatchAndSync(dir, addPatch(), { selectedOpIds: ["op_add"], now: "2026-05-19T10:00:00.000Z" }, fts);

    const events = readRecentRuntimeEvents(dir, { minSeverity: "medium" });
    expect(events.some((event) => event.component === "post-mutation" && event.message.includes("post_fts_sync") && event.message.includes("mem_added_sync"))).toBe(true);
  });

  test("applyPatchAndSync preserves patch behavior (audit trail, projection)", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const fts = new MemoryFtsIndex(join(dir, "search", "fts.db"));
    syncFtsIndex(dir, fts);

    const applied = applyPatchAndSync(dir, deletePatch("audit_preserving"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" }, fts);

    expect(applied.status).toBe("applied");
    expect(applied.applied_ops).toContain("op_001");
    expect(existsSync(join(dir, "patches", "patch_del_audit_preserving.json"))).toBe(true);
    const rendered = readFileSync(join(dir, "rendered", "MEMORY.md"), "utf-8");
    expect(rendered).not.toContain("abc123");
    fts.close();
  });
});
