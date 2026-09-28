import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { readCanonicalState, writeCanonicalStateAtomic } from "./governance-generation";
import { resolvePaths, ensureMemoryDirs } from "./paths";
import { renderMemoryToDisk } from "./render";
import type { MemoryPatch } from "./types";

export type GovernanceTransactionStage =
  | "validated"
  | "staged"
  | "intent_written"
  | "canonical_published"
  | "generation_published"
  | "projections_derived"
  | "complete";

export interface GovernanceTransactionManifest {
  transaction_id: string;
  stage: GovernanceTransactionStage;
  expected_generation: number;
  next_generation: number;
  created_at: string;
  updated_at: string;
  result?: MemoryPatch;
}

export interface GovernanceTransactionOptions {
  transactionId: string;
  expectedGeneration?: number;
  now: string;
  faultAfterStage?: GovernanceTransactionStage;
}

export class StaleCanonicalGenerationError extends Error {
  constructor(expected: number, actual: number) {
    super(`Stale canonical generation: expected ${expected}, found ${actual}`);
    this.name = "StaleCanonicalGenerationError";
  }
}

function safeTransactionId(value: string): string {
  if (!value || basename(value) !== value || value === "." || value === "..") throw new Error("Invalid governance transaction ID");
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function manifestPath(root: string, transactionId: string): string {
  return join(resolvePaths(root).governance.transactions, safeTransactionId(transactionId), "intent.json");
}

function writeManifest(root: string, manifest: GovernanceTransactionManifest): void {
  const file = manifestPath(root, manifest.transaction_id);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

export function readTransactionManifest(root: string, transactionId: string): GovernanceTransactionManifest | null {
  const file = manifestPath(root, transactionId);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as GovernanceTransactionManifest;
}

function maybeFault(options: GovernanceTransactionOptions, stage: GovernanceTransactionStage): void {
  if (options.faultAfterStage === stage) throw new Error(`Injected governance transaction fault after ${stage}`);
}

function cloneLiveStore(root: string): string {
  ensureMemoryDirs(root);
  const workspace = mkdtempSync(join(tmpdir(), "pi-governance-tx-"));
  cpSync(root, workspace, { recursive: true, force: true });
  rmSync(join(workspace, "governance"), { recursive: true, force: true });
  ensureMemoryDirs(workspace);
  return workspace;
}

const PUBLISH_ENTRIES = ["memory", "inbox", "patches", "runtime", "reports", "rendered"] as const;

function publishWorkspace(root: string, workspace: string): void {
  for (const entry of PUBLISH_ENTRIES) {
    const source = join(workspace, entry);
    const destination = join(root, entry);
    if (!existsSync(source)) continue;
    const staged = `${destination}.tx-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    rmSync(staged, { recursive: true, force: true });
    cpSync(source, staged, { recursive: true, force: true });
    rmSync(destination, { recursive: true, force: true });
    renameSync(staged, destination);
  }
}

export function runGovernanceTransaction(
  root: string,
  options: GovernanceTransactionOptions,
  mutateWorkspace: (workspaceRoot: string) => MemoryPatch,
): MemoryPatch {
  ensureMemoryDirs(root);
  const state = readCanonicalState(root);
  const expected = options.expectedGeneration ?? state.generation;
  if (state.generation !== expected) throw new StaleCanonicalGenerationError(expected, state.generation);
  const next = state.generation + 1;
  const transactionId = safeTransactionId(options.transactionId);
  let manifest: GovernanceTransactionManifest = {
    transaction_id: transactionId,
    stage: "validated",
    expected_generation: state.generation,
    next_generation: next,
    created_at: options.now,
    updated_at: options.now,
  };
  maybeFault(options, "validated");

  const workspace = cloneLiveStore(root);
  try {
    const result = mutateWorkspace(workspace);
    if (result.applied_ops.length === 0) return result;

    manifest = { ...manifest, stage: "staged", updated_at: options.now, result };
    maybeFault(options, "staged");
    manifest = { ...manifest, stage: "intent_written" };
    writeManifest(root, manifest);
    maybeFault(options, "intent_written");

    publishWorkspace(root, workspace);
    manifest = { ...manifest, stage: "canonical_published" };
    writeManifest(root, manifest);
    maybeFault(options, "canonical_published");

    writeCanonicalStateAtomic(root, { generation: next, last_transaction_id: transactionId, updated_at: options.now });
    manifest = { ...manifest, stage: "generation_published" };
    writeManifest(root, manifest);
    maybeFault(options, "generation_published");

    renderMemoryToDisk(root, next);
    manifest = { ...manifest, stage: "projections_derived" };
    writeManifest(root, manifest);
    maybeFault(options, "projections_derived");

    manifest = { ...manifest, stage: "complete", result };
    writeManifest(root, manifest);
    maybeFault(options, "complete");
    return result;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
