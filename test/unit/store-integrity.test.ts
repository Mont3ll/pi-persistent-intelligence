import { describe, expect, test } from "bun:test";
import { planStoreIntegrity, type IntegritySourceRow } from "../../src/store-integrity";
import type { MemoryRecord } from "../../src/types";

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
