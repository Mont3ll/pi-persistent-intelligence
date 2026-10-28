import { createHash } from "node:crypto";
import { closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { readCanonicalState, writeCanonicalStateAtomic } from "./governance-generation";
import { acquireGovernanceWriterLock, StaleCanonicalGenerationError } from "./governance-writer-lock";
import { resolvePaths, ensureMemoryDirs } from "./paths";
import { renderMemoryToDisk } from "./render";
import { governanceManifestSnapshotDirectory } from "./privacy-artifacts";
import type { MemoryPatch } from "./types";

export { StaleCanonicalGenerationError } from "./governance-writer-lock";
export type GovernanceTransactionStage = "validated" | "staged" | "intent_written" | "canonical_published" | "generation_published" | "projections_derived" | "complete";
export interface GovernanceTransactionManifest { transaction_id: string; stage: GovernanceTransactionStage; expected_generation: number; next_generation: number; created_at: string; updated_at: string; result?: MemoryPatch; }
export interface GovernanceTransactionOptions { transactionId: string; expectedGeneration?: number; now: string; faultAfterStage?: GovernanceTransactionStage; snapshotPrivacyManifests?: boolean; }
export class GovernanceRecoveryBlockedError extends Error { constructor(message: string) { super(message); this.name = "GovernanceRecoveryBlockedError"; } }

function safeTransactionId(value: string): string { if (!value || basename(value) !== value || value === "." || value === "..") throw new Error("Invalid governance transaction ID"); return value.replace(/[^a-zA-Z0-9_.-]/g, "_"); }
export function transactionDirectory(root: string, transactionId: string): string { return join(resolvePaths(root).governance.transactions, safeTransactionId(transactionId)); }
export function transactionManifestPath(root: string, transactionId: string): string { return join(transactionDirectory(root, transactionId), "intent.json"); }
export function transactionWorkspacePath(root: string, transactionId: string): string { return join(transactionDirectory(root, transactionId), "workspace"); }
export function writeTransactionManifest(root: string, manifest: GovernanceTransactionManifest): void {
  const file = transactionManifestPath(root, manifest.transaction_id); mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`; const fd = openSync(temporary, "wx", 0o600);
  try { writeSync(fd, `${JSON.stringify(manifest, null, 2)}\n`, undefined, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, file);
}
export function readTransactionManifest(root: string, transactionId: string): GovernanceTransactionManifest | null { const file = transactionManifestPath(root, transactionId); return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as GovernanceTransactionManifest : null; }
export function listTransactionIds(root: string): string[] { const dir = resolvePaths(root).governance.transactions; return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() : []; }
function maybeFault(options: GovernanceTransactionOptions, stage: GovernanceTransactionStage): void { if (options.faultAfterStage === stage) throw new Error(`Injected governance transaction fault after ${stage}`); }

const WORKSPACE_ENTRIES = ["config.json", "schemas", "memory", "rendered", "scratchpad.md", "daily", "inbox", "patches", "runtime", "reports", "sessions", "search"] as const;
const CANONICAL_ENTRIES = ["memory", "inbox"] as const;
const AUXILIARY_ENTRIES = ["patches", "runtime", "reports"] as const;
function walkFiles(root: string, entry: string): string[] { const target = join(root, entry); if (!existsSync(target)) return []; if (!statSync(target).isDirectory()) return [target]; return readdirSync(target, { withFileTypes: true }).flatMap((child) => child.isDirectory() ? walkFiles(root, join(entry, child.name)) : [join(root, entry, child.name)]); }
function fingerprint(root: string, entries: readonly string[]): string { const hash = createHash("sha256"); for (const file of entries.flatMap((entry) => walkFiles(root, entry)).sort()) { hash.update(relative(root, file)); hash.update("\0"); hash.update(readFileSync(file)); hash.update("\0"); } return hash.digest("hex"); }
/**
 * A privacy purge must redact historical completed transaction results,
 * but mutating those receipts before a durable purge intent would be unsafe.
 * Snapshot only completed manifests into the transaction workspace. Keep
 * originals alongside working copies to verify publication/recovery.
 */
function snapshotPrivacyManifests(root: string, workspace: string): void {
  const snapshots = governanceManifestSnapshotDirectory(workspace);
  const originalDir = join(snapshots, "original");
  const workingDir = join(snapshots, "working");
  mkdirSync(originalDir, { recursive: true });
  mkdirSync(workingDir, { recursive: true });
  // The writer created its own transaction directory and workspace before
  // invoking this preflight. That directory has no intent yet; it is NOT a
  // prior transaction and must never be snapshotted as historical evidence.
  const currentTransactionId = basename(dirname(workspace));
  for (const id of listTransactionIds(root)) {
    if (id === currentTransactionId) continue;
    const path = transactionManifestPath(root, id);
    if (!existsSync(path)) throw new GovernanceRecoveryBlockedError(`Missing manifest for governance transaction ${id}`);
    const raw = readFileSync(path, "utf8");
    const manifest: GovernanceTransactionManifest = JSON.parse(raw);
    if (manifest.transaction_id !== id || manifest.stage !== "complete" || !manifest.result) {
      throw new GovernanceRecoveryBlockedError(`Incomplete or invalid governance manifest ${id} prevents privacy purge`);
    }
    const name = `${safeTransactionId(id)}.json`;
    writeFileSync(join(originalDir, name), raw, { mode: 0o600 });
    writeFileSync(join(workingDir, name), raw, { mode: 0o600 });
  }
}

function cloneLiveStore(root: string, transactionId: string, privacyManifestSnapshot = false): string {
  ensureMemoryDirs(root);
  const workspace = transactionWorkspacePath(root, transactionId);
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  for (const entry of WORKSPACE_ENTRIES) {
    const source = join(root, entry);
    if (existsSync(source)) cpSync(source, join(workspace, entry), { recursive: true, force: true });
  }
  try {
    ensureMemoryDirs(workspace);
    if (privacyManifestSnapshot) snapshotPrivacyManifests(root, workspace);
    return workspace;
  } catch (error) {
    // The transaction has not written durable intent. Do not retain copies
    // of private historical manifests after a failed preflight snapshot.
    rmSync(transactionDirectory(root, transactionId), { recursive: true, force: true });
    throw error;
  }
}

/**
 * Publish redactions before canonical data, so replaying an old completed
 * receipt cannot leak private content after canonical purge publication.
 * Recovery is idempotent if a crash happened after a subset was redacted.
 */
function publishPrivacyManifestRedactions(root: string, workspace: string): void {
  const snapshots = governanceManifestSnapshotDirectory(workspace);
  const originals = join(snapshots, "original");
  const working = join(snapshots, "working");
  if (!existsSync(working)) return;
  const changes: GovernanceTransactionManifest[] = [];
  // Validate ALL historical manifest snapshots and current live state before
  // rewriting any of them. On recovery, already-published redactions are
  // allowed, but divergent historical receipts stop the purge.
  for (const entry of readdirSync(working, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      throw new GovernanceRecoveryBlockedError("Invalid governance manifest redaction snapshot");
    }
    const id = entry.name.slice(0, -5);
    const original = readFileSync(join(originals, entry.name), "utf8");
    const redacted = readFileSync(join(working, entry.name), "utf8");
    if (original === redacted) continue;
    const manifest = JSON.parse(redacted) as GovernanceTransactionManifest;
    if (manifest.transaction_id !== id || manifest.stage !== "complete" || !manifest.result) {
      throw new GovernanceRecoveryBlockedError(`Invalid redacted governance manifest ${id}`);
    }
    const live = readFileSync(transactionManifestPath(root, id), "utf8");
    if (live === redacted) continue; // already published before interrupted recovery
    if (live !== original) {
      throw new GovernanceRecoveryBlockedError(`Governance manifest ${id} changed during privacy purge`);
    }
    changes.push(manifest);
  }
  for (const manifest of changes) writeTransactionManifest(root, manifest);

  // A completed transaction no longer needs its workspace or orphaned
  // manifest temp writes. Those leftovers can retain the pre-purge content
  // even after intent.json itself has been redacted. Purge them only after
  // durable privacy intent, while the exclusive governance writer lock is
  // held; interruption is recoverable by rerunning this publication step.
  for (const entry of readdirSync(working, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      throw new GovernanceRecoveryBlockedError("Invalid governance cleanup snapshot");
    }
    const id = entry.name.slice(0, -5);
    const historical = readTransactionManifest(root, id);
    if (historical?.stage !== "complete") {
      throw new GovernanceRecoveryBlockedError(`Incomplete historical transaction ${id} during privacy cleanup`);
    }
    const directory = transactionDirectory(root, id);
    for (const child of readdirSync(directory, { withFileTypes: true })) {
      if (child.name === "workspace") {
        const leftover = join(directory, child.name);
        if (!lstatSync(leftover).isDirectory()) {
          throw new GovernanceRecoveryBlockedError(`Unexpected historical workspace type for ${id}`);
        }
        rmSync(leftover, { recursive: true, force: true });
      } else if (child.name.startsWith("intent.json.tmp-")) {
        const temporary = join(directory, child.name);
        if (!lstatSync(temporary).isFile()) {
          throw new GovernanceRecoveryBlockedError(`Unexpected historical manifest temporary type for ${id}`);
        }
        unlinkSync(temporary);
      }
    }
  }
}
function publishEntry(root: string, workspace: string, entry: string): void { const source = join(workspace, entry); if (!existsSync(source)) return; const destination = join(root, entry); const staged = `${destination}.tx-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`; rmSync(staged, { recursive: true, force: true }); cpSync(source, staged, { recursive: true, force: true }); rmSync(destination, { recursive: true, force: true }); renameSync(staged, destination); }
function publishEntries(root: string, workspace: string, entries: readonly string[]): void { for (const entry of entries) publishEntry(root, workspace, entry); }
export function publishTransactionWorkspace(root: string, transactionId: string): void { const workspace = transactionWorkspacePath(root, transactionId); if (!existsSync(workspace)) throw new GovernanceRecoveryBlockedError(`Missing transaction workspace for ${transactionId}`); publishPrivacyManifestRedactions(root, workspace); publishEntries(root, workspace, [...CANONICAL_ENTRIES, ...AUXILIARY_ENTRIES]); }

/**
 * Preserve every successful governed selection as its own immutable receipt.
 * patches/<patch_id>.json remains the legacy latest-view path, but must not
 * be treated as an exhaustive history when multiple subsets are applied.
 *
 * The result is already privacy-redacted by applyPatchDirect. This snapshot
 * lives in the transaction workspace and is published atomically with the
 * canonical change. Never write an attempt snapshot for a no-change result.
 */
function writeImmutableAttemptReceipt(workspace: string, transactionId: string, result: MemoryPatch): void {
  const directory = join(workspace, "patches", "receipts");
  mkdirSync(directory, { recursive: true });
  const filename = join(directory, `${safeTransactionId(transactionId)}.json`);
  const contents = `${JSON.stringify(result, null, 2)}\n`;
  if (existsSync(filename)) {
    if (readFileSync(filename, "utf8") !== contents) {
      throw new GovernanceRecoveryBlockedError(`Conflicting governed attempt receipt for ${transactionId}`);
    }
    return;
  }
  const fd = openSync(filename, "wx", 0o600);
  try {
    writeSync(fd, contents, undefined, "utf8");
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

/** Caller must hold the governance writer lock. */
export function completeInterruptedTransaction(root: string, manifest: GovernanceTransactionManifest, now: string): MemoryPatch {
  if (!manifest.result) throw new GovernanceRecoveryBlockedError(`Transaction ${manifest.transaction_id} has no persisted result`);
  if (manifest.stage === "complete") return manifest.result;
  const state = readCanonicalState(root);
  if (state.generation > manifest.next_generation) throw new GovernanceRecoveryBlockedError(`Canonical generation ${state.generation} is ahead of incomplete transaction ${manifest.transaction_id}`);
  if (state.generation !== manifest.expected_generation && state.generation !== manifest.next_generation) throw new GovernanceRecoveryBlockedError(`Canonical generation ${state.generation} does not match transaction ${manifest.transaction_id}`);
  let current = manifest;
  if (state.generation === manifest.expected_generation) {
    publishTransactionWorkspace(root, manifest.transaction_id); current = { ...current, stage: "canonical_published", updated_at: now }; writeTransactionManifest(root, current);
    writeCanonicalStateAtomic(root, { generation: manifest.next_generation, last_transaction_id: manifest.transaction_id, updated_at: now }); current = { ...current, stage: "generation_published", updated_at: now }; writeTransactionManifest(root, current);
  }
  renderMemoryToDisk(root, manifest.next_generation); current = { ...current, stage: "projections_derived", updated_at: now }; writeTransactionManifest(root, current);
  current = { ...current, stage: "complete", updated_at: now }; writeTransactionManifest(root, current); rmSync(transactionWorkspacePath(root, manifest.transaction_id), { recursive: true, force: true }); return manifest.result;
}

export function runGovernanceTransaction(root: string, options: GovernanceTransactionOptions, mutateWorkspace: (workspaceRoot: string) => MemoryPatch): MemoryPatch {
  ensureMemoryDirs(root); const transactionId = safeTransactionId(options.transactionId);
  const lock = acquireGovernanceWriterLock(root, { transactionId, expectedGeneration: options.expectedGeneration, now: options.now });
  try {
    const existing = readTransactionManifest(root, transactionId);
    if (existing?.stage === "complete" && existing.result) return existing.result;
    if (existing) return completeInterruptedTransaction(root, existing, options.now);
    const state = readCanonicalState(root);
    if (state.generation !== lock.observedGeneration) throw new StaleCanonicalGenerationError(lock.observedGeneration, state.generation);
    const next = state.generation + 1;
    let manifest: GovernanceTransactionManifest = { transaction_id: transactionId, stage: "validated", expected_generation: state.generation, next_generation: next, created_at: options.now, updated_at: options.now };
    maybeFault(options, "validated"); const workspace = cloneLiveStore(root, transactionId, options.snapshotPrivacyManifests === true); let durableIntent = false;
    try {
      const beforeCanonical = fingerprint(root, CANONICAL_ENTRIES); const result = mutateWorkspace(workspace); const canonicalChanged = beforeCanonical !== fingerprint(workspace, CANONICAL_ENTRIES);
      if (!canonicalChanged) { publishEntries(root, workspace, AUXILIARY_ENTRIES); rmSync(transactionDirectory(root, transactionId), { recursive: true, force: true }); return result; }
      writeImmutableAttemptReceipt(workspace, transactionId, result);
      manifest = { ...manifest, stage: "staged", updated_at: options.now, result }; maybeFault(options, "staged");
      manifest = { ...manifest, stage: "intent_written", updated_at: options.now }; writeTransactionManifest(root, manifest); durableIntent = true; maybeFault(options, "intent_written");
      publishTransactionWorkspace(root, transactionId); manifest = { ...manifest, stage: "canonical_published", updated_at: options.now }; writeTransactionManifest(root, manifest); maybeFault(options, "canonical_published");
      writeCanonicalStateAtomic(root, { generation: next, last_transaction_id: transactionId, updated_at: options.now }); manifest = { ...manifest, stage: "generation_published", updated_at: options.now }; writeTransactionManifest(root, manifest); maybeFault(options, "generation_published");
      renderMemoryToDisk(root, next); manifest = { ...manifest, stage: "projections_derived", updated_at: options.now }; writeTransactionManifest(root, manifest); maybeFault(options, "projections_derived");
      manifest = { ...manifest, stage: "complete", updated_at: options.now, result }; writeTransactionManifest(root, manifest); rmSync(workspace, { recursive: true, force: true }); maybeFault(options, "complete"); return result;
    } catch (error) { if (!durableIntent) rmSync(transactionDirectory(root, transactionId), { recursive: true, force: true }); throw error; }
  } finally { lock.release(); }
}
