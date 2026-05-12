import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readJsonl, appendJsonl, writeJsonl } from "./jsonl";
import { ensureMemoryDirs } from "./paths";
import { isMemoryRecord, type MemoryRecord } from "./types";

export function slugifyProject(project: string): string {
  return project.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}

function projectFile(root: string, project: string): string {
  const paths = ensureMemoryDirs(root);
  return join(paths.memory.projects, `${slugifyProject(project)}.jsonl`);
}

export function loadLayerRecords(root: string, layer: "L1" | "L2"): MemoryRecord[] {
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
  return loadAllRecords(root).filter((record) => record.status === "active");
}

export function addMemoryRecord(root: string, record: MemoryRecord): void {
  if (!isMemoryRecord(record)) throw new Error("Invalid memory record");
  const paths = ensureMemoryDirs(root);
  const file = record.scope.type === "project" && record.scope.project
    ? projectFile(root, record.scope.project)
    : record.layer === "L1" ? paths.memory.L1 : record.layer === "L2" ? paths.memory.L2 : undefined;
  if (!file) throw new Error("L3 records are not stored in canonical long-term files");
  appendJsonl(file, record);
}

export function replaceLayerRecords(root: string, layer: "L1" | "L2", records: MemoryRecord[]): void {
  const paths = ensureMemoryDirs(root);
  const file = layer === "L1" ? paths.memory.L1 : paths.memory.L2;
  writeJsonl(file, records);
}

export function replaceProjectRecords(root: string, project: string, records: MemoryRecord[]): void {
  writeJsonl(projectFile(root, project), records);
}

export function updateMemoryRecord(root: string, id: string, updater: (record: MemoryRecord) => MemoryRecord): boolean {
  for (const layer of ["L1", "L2"] as const) {
    const records = loadLayerRecords(root, layer);
    if (!records.some((record) => record.id === id)) continue;
    replaceLayerRecords(root, layer, records.map((record) => record.id === id ? updater(record) : record));
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
