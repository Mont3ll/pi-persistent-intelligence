import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

export class GovernanceRecoveryBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceRecoveryBlockedError";
  }
}

function safeTransactionId(value: string): string {
  if (!value || basename(value) !== value || value === "." || value === "..") throw new Error("Invalid governance transaction ID");
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

export function transactionDirectory(root: string, transactionId: string): string {
  return join(resolvePaths(root).governance.transactions, safeTransactionId(transactionId));
}

export function transactionManifestPath(root: string, transactionId: string): string {
  return join(transactionDirectory(root, transactionId), "intent.json");
}

export function transactionWorkspacePath(root: string, transactionId: string): string {
  return join(transactionDirectory(root, transactionId), "workspace");
}

export function writeTransactionManifest(root: string, manifest: GovernanceTransactionManifest): void {
  const file = transactionManifestPath(root, manifest.transaction_id);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

export function readTransactionManifest(root: string, transactionId: string): GovernanceTransactionManifest | null {
  const file = transactionManifestPath(root, transactionId);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as GovernanceTransactionManifest;
}

export function listTransactionIds(root: string): string[] {
  const dir = resolvePaths(root).governance.transactions;
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function maybeFault(options: GovernanceTransactionOptions, stage: GovernanceTransactionStage): void {
  if (options.faultAfterStage === stage) throw new Error(`Injected governance transaction fault after ${stage}`);
}

const WORKSPACE_ENTRIES = [
  "config.json",
  "schemas",
  "memory",
  "rendered",
  "scratchpad.md",
  "daily",
  "inbox",
  "patches",
  "runtime",
  "reports",
  "sessions",
  "search",
] as const;

const PUBLISH_ENTRIES = ["memory", "inbox", "patches", "runtime", "reports"] as const;

function cloneLiveStore(root: string, transactionId: string): string {
  ensureMemoryDirs(root);
  const workspace = transactionWorkspacePath(root, transactionId);
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  for (const entry of WORKSPACE_ENTRIES) {
    const source = join(root, entry);
    if (!existsSync(source)) continue;
    cpSync(source, join(workspace, entry), { recursive: true, force: true });
  }
  ensureMemoryDirs(workspace);
  return workspace;
}

function publishEntry(root: string, workspace: string, entry: string): void {
  const source = join(workspace, entry);
  if (!existsSync(source)) return;
  const destination = join(root, entry);
  const staged = `${destination}.tx-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  rmSync(staged, { recursive: true, force: true });
  cpSync(source, staged, { recursive: true, force: true });
  rmSync(destination, { recursive: true, force: true });
  renameSync(staged, destination);
}

export function publishTransactionWorkspace(root: string, transactionId: string): void {
  const workspace = transactionWorkspacePath(root, transactionId);
  if (!existsSync(workspace)) throw new GovernanceRecoveryBlockedError(`Missing transaction workspace for ${transactionId}`);
  for (const entry of PUBLISH_ENTRIES) publishEntry(root, workspace, entry);
}

export function completeInterruptedTransaction(root: string, manifest: GovernanceTransactionManifest, now: string): MemoryPatch {
  if (!manifest.result) throw new GovernanceRecoveryBlockedError(`Transaction ${manifest.transaction_id} has no persisted result`);
  if (manifest.stage === "complete") return manifest.result;

  const state = readCanonicalState(root);
  if (state.generation > manifest.next_generation) {
    throw new GovernanceRecoveryBlockedError(`Canonical generation ${state.generation} is ahead of incomplete transaction ${manifest.transaction_id}`);
  }
  if (state.generation !== manifest.expected_generation && state.generation !== manifest.next_generation) {
    throw new GovernanceRecoveryBlockedError(`Canonical generation ${state.generation} does not match transaction ${manifest.transaction_id}`);
  }

  let current = manifest;
  if (state.generation === manifest.expected_generation) {
    publishTransactionWorkspace(root, manifest.transaction_id);
    current = { ...current, stage: "canonical_published", updated_at: now };
    writeTransactionManifest(root, current);
    writeCanonicalStateAtomic(root, {
      generation: manifest.next_generation,
      last_transaction_id: manifest.transaction_id,
      updated_at: now,
    });
    current = { ...current, stage: "generation_published", updated_at: now };
    writeTransactionManifest(root, current);
  }

  renderMemoryToDisk(root, manifest.next_generation);
  current = { ...current, stage: "projections_derived", updated_at: now };
  writeTransactionManifest(root, current);
  current = { ...current, stage: "complete", updated_at: now };
  writeTransactionManifest(root, current);
  rmSync(transactionWorkspacePath(root, manifest.transaction_id), { recursive: true, force: true });
  return manifest.result;
}

export function runGovernanceTransaction(
  root: string,
  options: GovernanceTransactionOptions,
  mutateWorkspace: (workspaceRoot: string) => MemoryPatch,
): MemoryPatch {
  ensureMemoryDirs(root);
  const transactionId = safeTransactionId(options.transactionId);
  const existing = readTransactionManifest(root, transactionId);
  if (existing?.stage === "complete" && existing.result) return existing.result;
  if (existing) return completeInterruptedTransaction(root, existing, options.now);

  const state = readCanonicalState(root);
  const expected = options.expectedGeneration ?? state.generation;
  if (state.generation !== expected) throw new StaleCanonicalGenerationError(expected, state.generation);
  const next = state.generation + 1;
  let manifest: GovernanceTransactionManifest = {
    transaction_id: transactionId,
    stage: "validated",
    expected_generation: state.generation,
    next_generation: next,
    created_at: options.now,
    updated_at: options.now,
  };
  maybeFault(options, "validated");

  const workspace = cloneLiveStore(root, transactionId);
  let durableIntent = false;
  try {
    const result = mutateWorkspace(workspace);
    if (result.applied_ops.length === 0) {
      rmSync(transactionDirectory(root, transactionId), { recursive: true, force: true });
      return result;
    }

    manifest = { ...manifest, stage: "staged", updated_at: options.now, result };
    maybeFault(options, "staged");
    manifest = { ...manifest, stage: "intent_written", updated_at: options.now };
    writeTransactionManifest(root, manifest);
    durableIntent = true;
    maybeFault(options, "intent_written");

    publishTransactionWorkspace(root, transactionId);
    manifest = { ...manifest, stage: "canonical_published", updated_at: options.now };
    writeTransactionManifest(root, manifest);
    maybeFault(options, "canonical_published");

    writeCanonicalStateAtomic(root, { generation: next, last_transaction_id: transactionId, updated_at: options.now });
    manifest = { ...manifest, stage: "generation_published", updated_at: options.now };
    writeTransactionManifest(root, manifest);
    maybeFault(options, "generation_published");

    renderMemoryToDisk(root, next);
    manifest = { ...manifest, stage: "projections_derived", updated_at: options.now };
    writeTransactionManifest(root, manifest);
    maybeFault(options, "projections_derived");

    manifest = { ...manifest, stage: "complete", updated_at: options.now, result };
    writeTransactionManifest(root, manifest);
    rmSync(workspace, { recursive: true, force: true });
    maybeFault(options, "complete");
    return result;
  } catch (error) {
    if (!durableIntent) rmSync(transactionDirectory(root, transactionId), { recursive: true, force: true });
    throw error;
  }
}
