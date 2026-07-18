import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { applyStoreIntegrityPlan, planStoreIntegrity, scanStoreIntegrity, type IntegritySourceRow } from "../../src/store-integrity";
import type { MemoryRecord } from "../../src/types";

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function record(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "project", project: "demo" },
    tags: ["workflow"],
    statement: `${id} statement`,
    evidence: [{ type: "manual", ref: "daily/2026-07-18.md", note: "captured" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-07-18",
    updated_at: "2026-07-18",
    review: { cadence_days: 30, next_review: "2026-08-17", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...overrides,
  };
}

function row(file: string, ordinal: number, value: MemoryRecord): IntegritySourceRow {
  return { file, ordinal, record: value };
}

function fixtureRoot(records: MemoryRecord[]): string {
  const root = mkdtempSync(join(tmpdir(), "pi-integrity-"));
  roots.push(root);
  const paths = ensureMemoryDirs(root);
  writeFileSync(paths.memory.L2, `${records.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf-8");
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

describe("store integrity planner", () => {
  test("keeps the last duplicate row and merges non-self relationships", () => {
    const rows = [
      row("memory/projects/demo.jsonl", 1, record("mem_dup", {
        status: "superseded",
        supersedes: ["mem_predecessor"],
        superseded_by: ["mem_dup"],
      })),
      row("memory/projects/demo.jsonl", 2, record("mem_other")),
      row("memory/projects/demo.jsonl", 3, record("mem_dup", {
        statement: "effective statement",
        supersedes: ["mem_dup"],
        superseded_by: [],
      })),
      row("memory/projects/demo.jsonl", 4, record("mem_dup", {
        statement: "latest statement",
        supersedes: ["mem_dup", "mem_second_predecessor"],
        superseded_by: ["mem_dup"],
      })),
    ];

    const plan = planStoreIntegrity(rows);

    expect(plan).toMatchObject({
      dry_run: true,
      mutation_performed: false,
      migration_needed: true,
      rows_before: 4,
      unique_ids_before: 2,
      rows_after: 2,
      duplicate_groups: 1,
      rows_removed: 2,
      self_edges_removed: 4,
      groups_repaired: 1,
      groups_skipped: 0,
    });
    expect(plan.groups[0]).toMatchObject({
      id: "mem_dup",
      canonical_ordinal: 4,
      removed_rows: 2,
      retained_supersedes: ["mem_predecessor", "mem_second_predecessor"],
      retained_superseded_by: [],
      removed_self_edges: 4,
      status: "repairable",
    });
    expect(plan.repaired_rows.find((item) => item.record.id === "mem_dup")?.record).toMatchObject({
      statement: "latest statement",
      supersedes: ["mem_predecessor", "mem_second_predecessor"],
      superseded_by: [],
    });
  });

  test("preserves an external successor on an externally superseded final row", () => {
    const rows = [
      row("memory/projects/demo.jsonl", 1, record("mem_dup", {
        status: "superseded",
        supersedes: ["mem_predecessor"],
        superseded_by: ["mem_dup"],
      })),
      row("memory/projects/demo.jsonl", 2, record("mem_dup", {
        status: "superseded",
        supersedes: ["mem_dup"],
        superseded_by: ["mem_successor"],
      })),
    ];

    const plan = planStoreIntegrity(rows);

    expect(plan.repaired_rows[0].record).toMatchObject({
      status: "superseded",
      supersedes: ["mem_predecessor"],
      superseded_by: ["mem_successor"],
    });
  });

  test("does not repair an id that spans incompatible canonical routes", () => {
    const rows = [
      row("memory/L2.playbooks.jsonl", 1, record("mem_dup", { scope: { type: "global" } })),
      row("memory/projects/demo.jsonl", 1, record("mem_dup")),
    ];

    const plan = planStoreIntegrity(rows);

    expect(plan).toMatchObject({
      migration_needed: true,
      rows_before: 2,
      rows_after: 2,
      groups_repaired: 0,
      groups_skipped: 1,
    });
    expect(plan.groups[0]).toMatchObject({
      id: "mem_dup",
      status: "ambiguous_storage_route",
      canonical_ordinal: null,
      removed_rows: 0,
    });
    expect(plan.repaired_rows).toHaveLength(2);
  });

  test("is deterministic and reports no migration for a clean store", () => {
    const rows = [row("memory/L2.playbooks.jsonl", 1, record("mem_clean", { scope: { type: "global" } }))];

    const first = planStoreIntegrity(rows);
    const second = planStoreIntegrity(rows);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      migration_needed: false,
      rows_before: 1,
      unique_ids_before: 1,
      rows_after: 1,
      duplicate_groups: 0,
      groups_repaired: 0,
      groups_skipped: 0,
    });
  });
});

describe("store integrity migration", () => {
  test("preview is side-effect free", () => {
    const root = fixtureRoot([
      record("mem_dup", { status: "superseded", superseded_by: ["mem_dup"] }),
      record("mem_dup", { supersedes: ["mem_dup"] }),
    ]);
    const before = snapshot(root);

    const plan = scanStoreIntegrity(root);

    expect(plan.migration_needed).toBe(true);
    expect(snapshot(root)).toEqual(before);
  });

  test("apply creates a byte-exact backup, audit report, and idempotent repaired store", () => {
    const original = [
      record("mem_dup", { status: "superseded", supersedes: ["mem_predecessor"], superseded_by: ["mem_dup"] }),
      record("mem_dup", { statement: "effective", supersedes: ["mem_dup"] }),
      record("mem_clean"),
    ];
    const root = fixtureRoot(original);
    const originalBytes = readFileSync(join(root, "memory", "L2.playbooks.jsonl"), "utf-8");
    const plan = scanStoreIntegrity(root);

    const result = applyStoreIntegrityPlan(root, plan.fingerprint, "2026-07-18T07:30:00.000Z");

    expect(result).toMatchObject({
      dry_run: false,
      mutation_performed: true,
      rows_before: 3,
      rows_after: 2,
      rows_removed: 1,
      self_edges_removed: 2,
      post_apply_errors: 0,
    });
    expect(result.backup_path).toBeTruthy();
    expect(result.report_path).toBeTruthy();
    expect(readFileSync(join(result.backup_path!, "memory", "L2.playbooks.jsonl"), "utf-8")).toBe(originalBytes);
    expect(JSON.parse(readFileSync(result.report_path!, "utf-8"))).toMatchObject({ mutation_performed: true, rows_after: 2 });

    const repaired = readFileSync(join(root, "memory", "L2.playbooks.jsonl"), "utf-8")
      .trim().split("\n").map((line) => JSON.parse(line) as MemoryRecord);
    expect(repaired).toHaveLength(2);
    expect(repaired.find((item) => item.id === "mem_dup")).toMatchObject({
      statement: "effective",
      supersedes: ["mem_predecessor"],
      superseded_by: [],
    });
    expect(scanStoreIntegrity(root).migration_needed).toBe(false);
  });

  test("apply refuses a stale preview fingerprint before writing", () => {
    const root = fixtureRoot([
      record("mem_dup", { superseded_by: ["mem_dup"] }),
      record("mem_dup", { supersedes: ["mem_dup"] }),
    ]);
    const plan = scanStoreIntegrity(root);
    const path = join(root, "memory", "L2.playbooks.jsonl");
    writeFileSync(path, `${readFileSync(path, "utf-8")}${JSON.stringify(record("mem_new"))}\n`, "utf-8");
    const before = snapshot(root);

    expect(() => applyStoreIntegrityPlan(root, plan.fingerprint, "2026-07-18T07:30:00.000Z")).toThrow(
      "Store integrity plan is stale; run preview again before applying.",
    );
    expect(snapshot(root)).toEqual(before);
  });
});
