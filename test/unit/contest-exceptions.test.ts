import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { applyPatch } from "../../src/patch";
import { unsafeAddMemoryRecord as addMemoryRecord, loadAllRecords } from "../../src/store";
import type { MemoryPatch, MemoryRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-contest-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem_1",
    layer: "L2",
    scope: { type: "global" },
    tags: ["workflow"],
    statement: "Use bun for local tests.",
    evidence: [{ type: "manual", ref: "x", note: "n" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-05-19",
    updated_at: "2026-05-19",
    review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "If contradicted, revise." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "prefer_pattern",
    ...overrides,
  };
}

function patch(op: MemoryPatch["ops"][number]): MemoryPatch {
  return {
    patch_id: "patch_test",
    created_at: "2026-05-19T10:00:00.000Z",
    generated_by: "manual",
    mode: "propose",
    summary: "test",
    ops: [op],
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}

describe("contested status and exception patches", () => {
  test("contest patch marks active memory contested", () => {
    const dir = root();
    addMemoryRecord(dir, record());
    applyPatch(dir, patch({ op_id: "op_001", op: "contest", target_id: "mem_1", reason: "Contradicted by user", risk: "medium", default_selected: true }), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });
    const updated = loadAllRecords(dir).find((item) => item.id === "mem_1");
    expect(updated?.status).toBe("contested");
    expect(updated?.updated_at).toBe("2026-05-19");
  });

  test("uncontest patch restores contested memory to active", () => {
    const dir = root();
    addMemoryRecord(dir, record({ status: "contested" }));
    applyPatch(dir, patch({ op_id: "op_001", op: "uncontest", target_id: "mem_1", reason: "Reviewed", risk: "medium", default_selected: true }), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });
    expect(loadAllRecords(dir).find((item) => item.id === "mem_1")?.status).toBe("active");
  });

  test("add_exception patch merges exception fields without duplicates", () => {
    const dir = root();
    addMemoryRecord(dir, record({ applies_when: ["local development"], does_not_apply_when: ["publishing"], known_exceptions: ["CI publish uses npm"] }));
    applyPatch(dir, patch({
      op_id: "op_001",
      op: "add_exception",
      target_id: "mem_1",
      updates: {
        applies_when: ["local development", "tests"],
        does_not_apply_when: ["publishing", "GitHub Packages"],
        known_exceptions: ["CI publish uses npm", "npm registry publish"],
      },
      reason: "Narrow scope",
      risk: "medium",
      default_selected: true,
    }), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });
    const updated = loadAllRecords(dir).find((item) => item.id === "mem_1");
    expect(updated?.applies_when).toEqual(["local development", "tests"]);
    expect(updated?.does_not_apply_when).toEqual(["publishing", "GitHub Packages"]);
    expect(updated?.known_exceptions).toEqual(["CI publish uses npm", "npm registry publish"]);
  });
});
