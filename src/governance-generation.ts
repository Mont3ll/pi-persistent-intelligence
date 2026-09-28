import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { resolvePaths } from "./paths";

export interface CanonicalStateMetadata {
  generation: number;
  last_transaction_id: string | null;
  updated_at: string | null;
}

export type ProjectionName = "rendered" | "fts" | "qmd";
export type ProjectionGenerations = Partial<Record<ProjectionName, number>>;

const LEGACY_CANONICAL_STATE: CanonicalStateMetadata = {
  generation: 0,
  last_transaction_id: null,
  updated_at: null,
};

function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeSync(fd, `${JSON.stringify(value, null, 2)}\n`, undefined, "utf8");
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
  closeSync(fd);
  renameSync(temporary, file);
}

export function readCanonicalState(root: string): CanonicalStateMetadata {
  const file = resolvePaths(root).governance.canonicalState;
  if (!existsSync(file)) return { ...LEGACY_CANONICAL_STATE };
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<CanonicalStateMetadata>;
  const generation = typeof parsed.generation === "number" && Number.isInteger(parsed.generation) && parsed.generation >= 0
    ? parsed.generation
    : 0;
  return {
    generation,
    last_transaction_id: typeof parsed.last_transaction_id === "string" ? parsed.last_transaction_id : null,
    updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : null,
  };
}

export function readCanonicalGeneration(root: string): number {
  return readCanonicalState(root).generation;
}

export function writeCanonicalStateAtomic(root: string, state: CanonicalStateMetadata): void {
  writeJsonAtomic(resolvePaths(root).governance.canonicalState, state);
}

export function readProjectionGenerations(root: string): ProjectionGenerations {
  const file = resolvePaths(root).governance.projections;
  if (!existsSync(file)) return {};
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const result: ProjectionGenerations = {};
  for (const name of ["rendered", "fts", "qmd"] as const) {
    const value = parsed[name];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) result[name] = value;
  }
  return result;
}

export function readProjectionGeneration(root: string, name: ProjectionName): number | null {
  return readProjectionGenerations(root)[name] ?? null;
}

export function markProjectionGeneration(root: string, name: ProjectionName, generation: number): void {
  const current = readProjectionGenerations(root);
  writeJsonAtomic(resolvePaths(root).governance.projections, { ...current, [name]: generation });
}

export function projectionIsFresh(root: string, name: ProjectionName): boolean {
  return readProjectionGeneration(root, name) === readCanonicalGeneration(root);
}
