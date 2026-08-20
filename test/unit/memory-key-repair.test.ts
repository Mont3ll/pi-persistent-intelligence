import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanMemoryKeyRepair } from "../../src/memory-key-repair";
import { ensureMemoryDirs } from "../../src/paths";
import type { MemoryRecord } from "../../src/types";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function record(id: string, statement: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["capture-backfill", "user_preference", "writing"],
    statement,
    evidence: [{ type: "manual", ref: `session:${id}`, note: "captured" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-08-01",
    updated_at: "2026-08-01",
    review: { cadence_days: 30, next_review: "2026-08-31", change_condition: "If corrected." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "avoid_pattern",
    profile_id: "legacy",
    normalized_key: "legacy|global|global|capture-backfill|avoid-pattern",
    ...overrides,
  };
}

function fixtureRoot(records: MemoryRecord[]): string {
  const root = mkdtempSync(join(tmpdir(), "pi-memory-key-repair-"));
  roots.push(root);
  const paths = ensureMemoryDirs(root);
  writeFileSync(paths.memory.L2, `${records.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  return root;
}

function snapshot(root: string): Array<{ path: string; bytes: string; mtimeMs: number }> {
  const visit = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? visit(path) : [path];
  });
  return visit(root).sort().map((path) => ({
    path: path.slice(root.length),
    bytes: readFileSync(path).toString("base64"),
    mtimeMs: statSync(path).mtimeMs,
  }));
}

describe("memory key repair planner", () => {
  test("is read-only and deterministically lists exact eligible active records", () => {
    const root = fixtureRoot([
      record("mem_duplicate", "Avoid duplicate traversals."),
      record("mem_snake_case", "Avoid snake_case unless required."),
      record("mem_inactive", "Avoid inactive history.", { status: "superseded" }),
      record("mem_meaningful", "Avoid unrelated changes.", {
        tags: ["memory-governance"],
        normalized_key: "legacy|global|global|memory-governance|avoid-pattern",
      }),
    ]);
    const before = snapshot(root);

    const first = scanMemoryKeyRepair(root);
    const second = scanMemoryKeyRepair(root);

    expect(snapshot(root)).toEqual(before);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      version: 2,
      dryRun: true,
      mutationPerformed: false,
      targetCount: 2,
      affectedFileCount: 1,
      applyEligible: true,
      collisions: [],
    });
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.targets.map((target) => target.id)).toEqual(["mem_duplicate", "mem_snake_case"]);
    expect(first.targets.map((target) => target.oldKey)).toEqual([
      "legacy|global|global|capture-backfill|avoid-pattern",
      "legacy|global|global|capture-backfill|avoid-pattern",
    ]);
    expect(first.targets.map((target) => target.newKey)).toEqual([
      "v2|legacy|global|global|duplicate-traversals|avoid-pattern",
      "v2|legacy|global|global|snake-case-unless-required|avoid-pattern",
    ]);
    expect(first.targets.every((target) => /^[a-f0-9]{64}$/.test(target.sourceRecordHash))).toBe(true);
    expect(first.targets.every((target) => /^[a-f0-9]{64}$/.test(target.sourceFileHash))).toBe(true);
    expect(first.affectedFiles.every((file) => /^[a-f0-9]{64}$/.test(file.sourceFileHash))).toBe(true);
  });

  test("blocks apply when target records derive the same v2 key", () => {
    const root = fixtureRoot([
      record("mem_a", "Avoid duplicate traversals."),
      record("mem_b", "Never use duplicate traversals."),
    ]);

    const plan = scanMemoryKeyRepair(root);

    expect(plan.applyEligible).toBe(false);
    expect(plan.collisions).toEqual([{
      normalizedKey: "v2|legacy|global|global|duplicate-traversals|avoid-pattern",
      memoryIds: ["mem_a", "mem_b"],
    }]);
  });

  test("blocks apply when a target collides with an active non-target v2 record", () => {
    const target = record("mem_target", "Avoid duplicate traversals.");
    const existing = record("mem_existing", "Avoid duplicate traversals.", {
      tags: ["memory-governance"],
      normalized_key: "v2|legacy|global|global|duplicate-traversals|avoid-pattern",
    });
    const root = fixtureRoot([target, existing]);

    const plan = scanMemoryKeyRepair(root);

    expect(plan.applyEligible).toBe(false);
    expect(plan.collisions).toEqual([{
      normalizedKey: "v2|legacy|global|global|duplicate-traversals|avoid-pattern",
      memoryIds: ["mem_existing", "mem_target"],
    }]);
  });
});
