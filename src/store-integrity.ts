import { createHash } from "node:crypto";
import type { MemoryRecord } from "./types";

export type IntegrityGroupStatus = "repairable" | "ambiguous_storage_route";

export interface IntegritySourceRow {
  file: string;
  ordinal: number;
  record: MemoryRecord;
}

export interface IntegrityGroupDecision {
  id: string;
  status: IntegrityGroupStatus;
  source_rows: Array<{ file: string; ordinal: number }>;
  canonical_ordinal: number | null;
  removed_rows: number;
  retained_supersedes: string[];
  retained_superseded_by: string[];
  removed_self_edges: number;
  detail: string;
}

export interface StoreIntegrityPlan {
  dry_run: true;
  mutation_performed: false;
  migration_needed: boolean;
  fingerprint: string;
  rows_before: number;
  unique_ids_before: number;
  rows_after: number;
  duplicate_groups: number;
  rows_removed: number;
  self_edges_removed: number;
  groups_repaired: number;
  groups_skipped: number;
  groups: IntegrityGroupDecision[];
  repaired_rows: IntegritySourceRow[];
}

function uniqueNonSelf(rows: IntegritySourceRow[], field: "supersedes" | "superseded_by", id: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const row of rows) {
    for (const value of row.record[field]) {
      if (value === id || seen.has(value)) continue;
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}

function selfEdgeCount(rows: IntegritySourceRow[], id: string): number {
  return rows.reduce((count, row) =>
    count + row.record.supersedes.filter((value) => value === id).length
      + row.record.superseded_by.filter((value) => value === id).length,
  0);
}

function fingerprint(rows: IntegritySourceRow[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export function planStoreIntegrity(rows: IntegritySourceRow[]): StoreIntegrityPlan {
  const byId = new Map<string, IntegritySourceRow[]>();
  for (const row of rows) {
    const group = byId.get(row.record.id) ?? [];
    group.push(row);
    byId.set(row.record.id, group);
  }

  const replacements = new Map<number, IntegritySourceRow | null>();
  const groups: IntegrityGroupDecision[] = [];
  let duplicateGroups = 0;
  let rowsRemoved = 0;
  let selfEdgesRemoved = 0;
  let groupsRepaired = 0;
  let groupsSkipped = 0;

  for (const [id, sourceRows] of byId) {
    const duplicate = sourceRows.length > 1;
    const removedSelfEdges = selfEdgeCount(sourceRows, id);
    if (!duplicate && removedSelfEdges === 0) continue;
    if (duplicate) duplicateGroups++;

    const files = new Set(sourceRows.map((row) => row.file));
    if (files.size > 1) {
      groupsSkipped++;
      groups.push({
        id,
        status: "ambiguous_storage_route",
        source_rows: sourceRows.map(({ file, ordinal }) => ({ file, ordinal })),
        canonical_ordinal: null,
        removed_rows: 0,
        retained_supersedes: uniqueNonSelf(sourceRows, "supersedes", id),
        retained_superseded_by: uniqueNonSelf(sourceRows, "superseded_by", id),
        removed_self_edges: 0,
        detail: `Record ${id} spans multiple canonical files and requires manual review.`,
      });
      continue;
    }

    const canonical = sourceRows[sourceRows.length - 1];
    const retainedSupersedes = uniqueNonSelf(sourceRows, "supersedes", id);
    const retainedSupersededBy = uniqueNonSelf(sourceRows, "superseded_by", id);
    const repaired: IntegritySourceRow = {
      ...canonical,
      record: {
        ...canonical.record,
        supersedes: retainedSupersedes,
        superseded_by: retainedSupersededBy,
      },
    };

    for (const sourceRow of sourceRows) replacements.set(rows.indexOf(sourceRow), null);
    replacements.set(rows.indexOf(canonical), repaired);

    const removedRows = sourceRows.length - 1;
    rowsRemoved += removedRows;
    selfEdgesRemoved += removedSelfEdges;
    groupsRepaired++;
    groups.push({
      id,
      status: "repairable",
      source_rows: sourceRows.map(({ file, ordinal }) => ({ file, ordinal })),
      canonical_ordinal: canonical.ordinal,
      removed_rows: removedRows,
      retained_supersedes: retainedSupersedes,
      retained_superseded_by: retainedSupersededBy,
      removed_self_edges: removedSelfEdges,
      detail: `Keep the last physical row for ${id}, remove ${removedRows} duplicate row(s), and remove ${removedSelfEdges} self edge(s).`,
    });
  }

  const repairedRows = rows.flatMap((row, index) => {
    if (!replacements.has(index)) return [row];
    const replacement = replacements.get(index);
    return replacement ? [replacement] : [];
  });

  return {
    dry_run: true,
    mutation_performed: false,
    migration_needed: groups.length > 0,
    fingerprint: fingerprint(rows),
    rows_before: rows.length,
    unique_ids_before: byId.size,
    rows_after: repairedRows.length,
    duplicate_groups: duplicateGroups,
    rows_removed: rowsRemoved,
    self_edges_removed: selfEdgesRemoved,
    groups_repaired: groupsRepaired,
    groups_skipped: groupsSkipped,
    groups,
    repaired_rows: repairedRows,
  };
}
