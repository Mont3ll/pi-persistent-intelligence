import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { applyPatch } from "../../src/patch";
import { addMemoryRecord, loadActiveRecords, unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryPatch, MemoryRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-boundary-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function record(id = "mem_1"): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["workflow"],
    statement: "Use patches for durable memory writes.",
    evidence: [{ type: "manual", ref: "x", note: "n" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-05-19",
    updated_at: "2026-05-19",
    review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
  };
}

describe("direct store write boundary", () => {
  test("public addMemoryRecord requires patch apply context", () => {
    const dir = root();
    expect(() => addMemoryRecord(dir, record())).toThrow(/PatchApplyContext/);
  });

  test("unsafeAddMemoryRecord remains available for tests/import setup", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    expect(loadActiveRecords(dir).map((item) => item.id)).toEqual(["mem_1"]);
  });

  test("public curation/write flow uses patch governance", () => {
    const dir = root();
    const patch: MemoryPatch = {
      patch_id: "patch_add",
      created_at: "2026-05-19T10:00:00.000Z",
      generated_by: "curator",
      mode: "propose",
      summary: "add",
      ops: [{ op_id: "op_001", op: "add", record: record("mem_patch"), risk: "low", default_selected: true }],
      status: "proposed",
      applied_at: null,
      applied_ops: [],
      skipped_ops: [],
    };
    applyPatch(dir, patch, { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });
    expect(loadActiveRecords(dir).map((item) => item.id)).toEqual(["mem_patch"]);
  });
});
