import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readJsonl, appendJsonl, writeJsonl } from "./jsonl";
import { ensureMemoryDirs } from "./paths";
import { isTombstonedRecord } from "./tombstones";
import { isMemoryRecord, type MemoryRecord } from "./types";

const PATCH_CONTEXT_BRAND: unique symbol = Symbol("PatchApplyContext");
export interface PatchApplyContext { readonly [PATCH_CONTEXT_BRAND]: true }
export const PATCH_APPLY_CONTEXT: PatchApplyContext = { [PATCH_CONTEXT_BRAND]: true };

export function slugifyProject(project: string): string {
  return project.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}

function projectFile(root: string, project: string): string {
  const paths = ensureMemoryDirs(root);
  return join(paths.memory.projects, `${slugifyProject(project)}.jsonl`);
}

export function loadLayerRecords(root: string, layer: "L1" | "L2"): MemoryRecord[] {
  /**
   * Returns ALL records in the layer, including those with status: "deleted".
   * This is intentional for audit trail purposes.
   * Use loadActiveRecords() for injection/search — it filters by status and tombstones.
   */
  const paths = ensureMemoryDirs(root);
  const file = layer === "L1" ? paths.memory.L1 : paths.memory.L2;
  return readJsonl<MemoryRecord>(file).filter(isMemoryRecord);
}

export function loadProjectRecords(root: string, project: string): MemoryRecord[] {
  return readJsonl<MemoryRecord>(projectFile(root, project)).filter(isMemoryRecord);
}

export function loadAllProjectRecords(root: string): MemoryRecord[] {
  const paths = ensureMemoryDirs(root);
  if (!existsSync(paths.memory.projects)) return [];
  return readdirSync(paths.memory.projects)
    .filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => readJsonl<MemoryRecord>(join(paths.memory.projects, name)).filter(isMemoryRecord));
}

export function loadAllRecords(root: string): MemoryRecord[] {
  return [...loadLayerRecords(root, "L1"), ...loadLayerRecords(root, "L2"), ...loadAllProjectRecords(root)];
}

export function loadActiveRecords(root: string): MemoryRecord[] {
  return loadAllRecords(root).filter((record) => record.status === "active" && !isTombstonedRecord(root, record.id));
}

function assertPatchContext(context?: PatchApplyContext): void {
  if (context !== PATCH_APPLY_CONTEXT) throw new Error("PatchApplyContext required for canonical L1/L2 writes; use patch.apply or unsafe* test helpers.");
}

function targetFile(root: string, record: MemoryRecord): string {
  const paths = ensureMemoryDirs(root);
  const file = record.scope.type === "project" && record.scope.project
    ? projectFile(root, record.scope.project)
    : record.layer === "L1" ? paths.memory.L1 : record.layer === "L2" ? paths.memory.L2 : undefined;
  if (!file) throw new Error("L3 records are not stored in canonical long-term files");
  return file;
}

export function addMemoryRecord(root: string, record: MemoryRecord): void {
  assertPatchContext(undefined);
  unsafeAddMemoryRecord(root, record);
}

export function addMemoryRecordFromPatch(root: string, record: MemoryRecord): void {
  unsafeAddMemoryRecord(root, record);
}

export function unsafeAddMemoryRecord(root: string, record: MemoryRecord): void {
  if (!isMemoryRecord(record)) throw new Error("Invalid memory record");
  if (isTombstonedRecord(root, record.id)) throw new Error(`Cannot add tombstoned memory record: ${record.id}`);
  appendJsonl(targetFile(root, record), record);
}

export function replaceLayerRecords(root: string, layer: "L1" | "L2", records: MemoryRecord[], context?: PatchApplyContext): void {
  assertPatchContext(context);
  unsafeReplaceLayerRecords(root, layer, records);
}

export function unsafeReplaceLayerRecords(root: string, layer: "L1" | "L2", records: MemoryRecord[]): void {
  const paths = ensureMemoryDirs(root);
  const file = layer === "L1" ? paths.memory.L1 : paths.memory.L2;
  writeJsonl(file, records.filter((record) => !isTombstonedRecord(root, record.id)));
}

export function replaceProjectRecords(root: string, project: string, records: MemoryRecord[], context?: PatchApplyContext): void {
  assertPatchContext(context);
  unsafeReplaceProjectRecords(root, project, records);
}

export function unsafeReplaceProjectRecords(root: string, project: string, records: MemoryRecord[]): void {
  writeJsonl(projectFile(root, project), records.filter((record) => !isTombstonedRecord(root, record.id)));
}

export function updateMemoryRecord(root: string, id: string, updater: (record: MemoryRecord) => MemoryRecord, context?: PatchApplyContext): boolean {
  assertPatchContext(context);
  return unsafeUpdateMemoryRecord(root, id, updater);
}

export function unsafeUpdateMemoryRecord(root: string, id: string, updater: (record: MemoryRecord) => MemoryRecord): boolean {
  if (isTombstonedRecord(root, id)) return false;
  for (const layer of ["L1", "L2"] as const) {
    const paths = ensureMemoryDirs(root);
    const file = layer === "L1" ? paths.memory.L1 : paths.memory.L2;
    const records = readJsonl<MemoryRecord>(file).filter(isMemoryRecord);
    if (!records.some((record) => record.id === id)) continue;
    writeJsonl(file, records.map((record) => record.id === id ? updater(record) : record));
    return true;
  }
  const paths = ensureMemoryDirs(root);
  for (const name of readdirSync(paths.memory.projects).filter((entry) => entry.endsWith(".jsonl"))) {
    const file = join(paths.memory.projects, name);
    const records = readJsonl<MemoryRecord>(file).filter(isMemoryRecord);
    if (!records.some((record) => record.id === id)) continue;
    writeJsonl(file, records.map((record) => record.id === id ? updater(record) : record));
    return true;
  }
  return false;
}
