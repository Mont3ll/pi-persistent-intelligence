import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { runMemoryDiagnostics } from "./diagnostics";
import { readJsonl, writeJsonlAtomic } from "./jsonl";
import { resolvePaths } from "./paths";
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

export interface StoreIntegrityApplyResult {
  dry_run: false;
  mutation_performed: boolean;
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
  backup_path?: string;
  report_path?: string;
  post_apply_errors?: number;
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

function canonicalFiles(root: string): string[] {
  const paths = resolvePaths(root);
  const projects = existsSync(paths.memory.projects)
    ? readdirSync(paths.memory.projects)
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .map((name) => join(paths.memory.projects, name))
    : [];
  return [paths.memory.L1, paths.memory.L2, ...projects].filter(existsSync);
}

export function scanStoreIntegrity(root: string): StoreIntegrityPlan {
  const rows: IntegritySourceRow[] = [];
  for (const file of canonicalFiles(root)) {
    const records = readJsonl<MemoryRecord>(file);
    records.forEach((record, index) => rows.push({ file, ordinal: index + 1, record }));
  }
  return planStoreIntegrity(rows);
}

function timestampSlug(now: string): string {
  return now.replace(/[^0-9]/g, "").slice(0, 17);
}

export function applyStoreIntegrityPlan(root: string, expectedFingerprint: string, now = new Date().toISOString()): StoreIntegrityApplyResult {
  const plan = scanStoreIntegrity(root);
  if (plan.fingerprint !== expectedFingerprint) {
    throw new Error("Store integrity plan is stale; run preview again before applying.");
  }

  const base = {
    dry_run: false as const,
    mutation_performed: false,
    migration_needed: plan.migration_needed,
    fingerprint: plan.fingerprint,
    rows_before: plan.rows_before,
    unique_ids_before: plan.unique_ids_before,
    rows_after: plan.rows_after,
    duplicate_groups: plan.duplicate_groups,
    rows_removed: plan.rows_removed,
    self_edges_removed: plan.self_edges_removed,
    groups_repaired: plan.groups_repaired,
    groups_skipped: plan.groups_skipped,
    groups: plan.groups,
  };
  if (!plan.migration_needed || plan.groups_repaired === 0) return base;

  const affectedFiles = [...new Set(plan.groups
    .filter((group) => group.status === "repairable")
    .flatMap((group) => group.source_rows.map((source) => source.file)))].sort();
  const slug = timestampSlug(now);
  const backupPath = join(root, "backups", `store-integrity-v1-${slug}`);
  for (const file of affectedFiles) {
    const destination = join(backupPath, relative(root, file));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(file, destination);
  }

  for (const file of affectedFiles) {
    const records = plan.repaired_rows.filter((row) => row.file === file).map((row) => row.record);
    writeJsonlAtomic(file, records);
  }

  const reportPath = join(root, "reports", `store-integrity-${slug}.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  const postApplyDiagnostics = runMemoryDiagnostics(root);
  const result: StoreIntegrityApplyResult = {
    ...base,
    mutation_performed: true,
    backup_path: backupPath,
    report_path: reportPath,
    post_apply_errors: postApplyDiagnostics.summary.errors,
  };
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
  return result;
}
