import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRecallXray } from "../../src/recall-xray";
import { extractHardRules } from "../../src/rules";
import { applyPatch } from "../../src/patch";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-conflict-policy-")); ensureMemoryDirs(dir); return dir; }
function cleanup(dir: string): void { rmSync(dir, { recursive: true, force: true }); }
function rec(id: string, opts: Partial<MemoryRecord> = {}): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["testing"], statement: "Always run bun test before commit.", evidence: [{ type: "manual", ref: "ev", note: "n" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-06-15", updated_at: "2026-06-15", review: { cadence_days: 30, next_review: "2026-07-15", change_condition: "if changed" }, status: "active", supersedes: [], superseded_by: [], vault_ref: null, ruleType: "prefer_pattern", ...opts }; }

describe("formal conflict resolution policy", () => {
  test("privacy tombstone wins over recall and hard rules", () => {
    const dir = root();
    try {
      unsafeAddMemoryRecord(dir, rec("mem_delete"));
      applyPatch(dir, { patch_id: "p", created_at: "n", generated_by: "manual", mode: "propose", summary: "delete", status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [], ops: [{ op_id: "op", op: "delete", target_id: "mem_delete", deletion_mode: "privacy_purge", deletion_reason: "user_requested", risk: "high", default_selected: true }] }, { now: "2026-06-15T00:00:00Z" });
      const report = buildRecallXray(dir, { query: "bun test" });
      expect(report.included.some((item) => item.memory_id === "mem_delete")).toBe(false);
    } finally { cleanup(dir); }
  });

  test("contested memory is warning-only and never hard rule", () => {
    const record = rec("mem_contested", { status: "contested" });
    expect(extractHardRules([record])).toHaveLength(0);
  });

  test("negative-scope exception omits rather than conflicts", () => {
    const dir = root();
    try {
      unsafeAddMemoryRecord(dir, rec("mem_except", { does_not_apply_when: ["frontend"] }));
      const report = buildRecallXray(dir, { query: "frontend bun test", working_directory: "frontend" });
      expect(report.excluded.find((item) => item.memory_id === "mem_except")?.negative_scope_match).toBe(true);
    } finally { cleanup(dir); }
  });
});
