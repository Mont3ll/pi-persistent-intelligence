import { createHash } from "node:crypto";
import { basename } from "node:path";
import { readCanonicalGeneration } from "./governance-generation";
import { applyPatchDirect } from "./patch-direct";
import { assertGovernanceRecoveryClear, recoverGovernanceTransactions } from "./governance-recovery";
import { readTransactionManifest, runGovernanceTransaction, validatePrivacyHistoricalInventory, type GovernanceTransactionStage } from "./governance-transaction";
import type { MemoryPatch, PatchOp } from "./types";
import type { TranscriptProofOptions } from "./transcript-proof";

export { listPatchFiles, readPatchFile, writePatchFile } from "./patch-direct";

export interface ApplyPatchOptions {
  selectedOpIds?: string[];
  now: string;
  expectedGeneration?: number;
  faultAfterStage?: GovernanceTransactionStage;
  /** Trusted Pi transcript roots for gated verification/test harness. */
  trustedTranscriptOptions?: TranscriptProofOptions;
}

function validatePatchId(patchId: string): void {
  if (!patchId || basename(patchId) !== patchId || patchId === "." || patchId === "..") {
    throw new Error("Invalid patch ID: path components are not allowed");
  }
}

function selectedOps(patch: MemoryPatch, selectedOpIds?: string[]): PatchOp[] {
  return patch.ops.filter((op) => selectedOpIds ? selectedOpIds.includes(op.op_id) : op.default_selected);
}

function mayReplayCompletedReceipt(patch: MemoryPatch, selectedOpIds?: string[]): boolean {
  const selected = selectedOps(patch, selectedOpIds);
  return selected.length > 0 && selected.every((op) => op.op === "add" || op.op === "reject_candidate");
}

/**
 * An application receipt is for the exact proposal AND the selected subset.
 * Two selections of one patch (or changed op payloads under the same ID)
 * must never share a durable transaction identity.
 */
function attemptIdentity(patch: MemoryPatch, selectedOpIds?: string[]): string {
  const selected = selectedOps(patch, selectedOpIds).map((op) => op.op_id);
  const signature = createHash("sha256").update(JSON.stringify({
    patch_id: patch.patch_id,
    generated_by: patch.generated_by,
    mode: patch.mode,
    ops: patch.ops,
    selected,
  })).digest("hex").slice(0, 24);
  return `${patch.patch_id}.s${signature}`;
}

function transactionIdForAttempt(root: string, patch: MemoryPatch, selectedOpIds?: string[]): string {
  const id = attemptIdentity(patch, selectedOpIds);
  if (mayReplayCompletedReceipt(patch, selectedOpIds)) return id;
  return `${id}.g${readCanonicalGeneration(root)}`;
}

/**
 * A legacy receipt has no explicit selectedOpIds field. We can infer the
 * selection ONLY when applied_ops and skipped_ops jointly partition every
 * operation exactly once, and each "not_selected" reason is unambiguous.
 * Missing arrays, duplicate/unknown IDs, opaque historical skip codes or
 * contradictory classification mean there is no trustworthy replay proof.
 */
function legacyReceiptSelection(
  result: MemoryPatch,
): { kind: "known"; selected: string[] } | { kind: "ambiguous" } {
  if (!Array.isArray(result.ops) || !Array.isArray(result.applied_ops)
    || !Array.isArray(result.skipped_ops)
    || typeof result.applied_at !== "string" || !result.applied_at
    || !["applied", "partially_applied", "rejected_at_apply"].includes(result.status)) {
    return { kind: "ambiguous" };
  }
  const ids = result.ops.map((op) => op?.op_id);
  if (ids.some((id) => typeof id !== "string" || id.length === 0)
    || new Set(ids).size !== ids.length) return { kind: "ambiguous" };
  const all = new Set(ids);
  const applied = new Set<string>();
  for (const id of result.applied_ops) {
    if (typeof id !== "string" || !all.has(id) || applied.has(id)) return { kind: "ambiguous" };
    applied.add(id);
  }
  const skipped = new Map<string, string>();
  for (const entry of result.skipped_ops) {
    if (!entry || typeof entry !== "object" || typeof entry.op_id !== "string"
      || !all.has(entry.op_id) || applied.has(entry.op_id)
      || skipped.has(entry.op_id)
      || typeof entry.reason !== "string"
      || entry.reason === "legacy_unknown"
      || ![
        "not_selected", "duplicate_id", "invalidated_evidence",
        "unresolved_evidence", "tombstoned", "missing_target",
        "missing_candidate", "capture_policy_hold", "target_terminal",
        "self_supersession", "replacement_id_conflict",
        "malformed_operation",
      ].includes(entry.reason)) return { kind: "ambiguous" };
    skipped.set(entry.op_id, entry.reason);
  }
  if (applied.size + skipped.size !== ids.length) return { kind: "ambiguous" };
  const expectedStatus = applied.size === 0 && skipped.size > 0
    ? "rejected_at_apply" : skipped.size > 0 ? "partially_applied" : "applied";
  if (result.status !== expectedStatus) return { kind: "ambiguous" };
  return { kind: "known", selected: ids.filter((id) =>
    applied.has(id) || skipped.get(id) !== "not_selected") };
}

function matchingLegacyReceipt(
  patch: MemoryPatch,
  selectedOpIds: string[] | undefined,
  result: MemoryPatch,
): "match" | "different" | "ambiguous" {
  if (!result || result.patch_id !== patch.patch_id) return "different";
  // A completed transaction claiming this patch ID but lacking a parseable
  // saved proposal cannot justify either replay or another write.
  if (!Array.isArray(result.ops) || result.generated_by !== patch.generated_by
    || result.mode !== patch.mode) return "ambiguous";
  if (JSON.stringify(result.ops) !== JSON.stringify(patch.ops)) return "different";
  const selection = legacyReceiptSelection(result);
  if (selection.kind === "ambiguous") return "ambiguous";
  const expected = selectedOps(patch, selectedOpIds).map((op) => op.op_id);
  return JSON.stringify(expected) === JSON.stringify(selection.selected)
    ? "match" : "different";
}

export function applyPatch(root: string, patch: MemoryPatch, options: ApplyPatchOptions): MemoryPatch {
  validatePatchId(patch.patch_id);

  const privacyPurgeRequested = selectedOps(patch, options.selectedOpIds).some(
    (op) => op.op === "delete" && op.deletion_mode === "privacy_purge");
  // Recovery formerly discarded missing-manifest directories before purge
  // snapshot preflight could see them. Check the complete path inventory
  // first, then allow valid interrupted intents to recover, then enforce
  // completed history before initiating a new privacy purge.
  if (privacyPurgeRequested) validatePrivacyHistoricalInventory(root, undefined, true);
  const recovery = recoverGovernanceTransactions(root, options.now);
  assertGovernanceRecoveryClear(recovery);
  if (privacyPurgeRequested) validatePrivacyHistoricalInventory(root);

  // Only a matching selected subset may receive a recovered receipt.
  // Never reuse a different operation's result merely because the patch ID
  // or its minute-stamped prefix happens to be the same.
  const attempt = attemptIdentity(patch, options.selectedOpIds);
  const recoveredTransactionId = recovery.completed.find((transactionId) =>
    transactionId === attempt || transactionId.startsWith(`${attempt}.g`)
  );
  if (recoveredTransactionId) {
    const recovered = readTransactionManifest(root, recoveredTransactionId);
    if (recovered?.stage === "complete" && recovered.result) return recovered.result;
  }

  // Preserve exact replay for legacy complete manifests created before the
  // selection-keyed transaction namespace. Mismatched legacy receipts are
  // ignored, never returned as authorization for another selection.
  const legacyIds = [
    patch.patch_id,
    ...recovery.completed.filter((id) => id.startsWith(`${patch.patch_id}.g`)),
  ];
  for (const legacyId of legacyIds) {
    const legacy = readTransactionManifest(root, legacyId);
    if (legacy?.stage !== "complete" || !legacy.result) continue;
    const replay = matchingLegacyReceipt(patch, options.selectedOpIds, legacy.result);
    if (replay === "match") return legacy.result;
    if (replay === "ambiguous") {
      // An old transaction may already have applied a subset. Without a
      // provable partition, neither replay nor new writes are authorized.
      throw new Error(`Ambiguous legacy governance receipt ${legacyId}; manual reconciliation required`);
    }
  }

  return runGovernanceTransaction(
    root,
    {
      transactionId: transactionIdForAttempt(root, patch, options.selectedOpIds),
      // Historical governance results are redacted in a recoverable workspace
      // only for selected privacy-purge operations.
      snapshotPrivacyManifests: privacyPurgeRequested,
      expectedGeneration: options.expectedGeneration,
      now: options.now,
      faultAfterStage: options.faultAfterStage,
    },
    (workspaceRoot) => applyPatchDirect(workspaceRoot, patch, {
      selectedOpIds: options.selectedOpIds,
      now: options.now,
      // A curation-scoped discovery hint is not portable authorization.
      // Always rebuild the source lookup and reopen the original transcript
      // within the guarded transaction for a fresh apply-time proof.
      trustedTranscriptOptions: options.trustedTranscriptOptions
        ? { trustedSessionDirs: options.trustedTranscriptOptions.trustedSessionDirs }
        : undefined,
    }),
  );
}
