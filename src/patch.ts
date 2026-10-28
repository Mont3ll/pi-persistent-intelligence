import { createHash } from "node:crypto";
import { basename } from "node:path";
import { readCanonicalGeneration } from "./governance-generation";
import { applyPatchDirect } from "./patch-direct";
import { assertGovernanceRecoveryClear, recoverGovernanceTransactions } from "./governance-recovery";
import { readTransactionManifest, runGovernanceTransaction, type GovernanceTransactionStage } from "./governance-transaction";
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

/** Compatibility only: never reuse a pre-selection-identity legacy receipt
 * unless its persisted proposal and selected subset exactly match this call. */
function matchingLegacyReceipt(patch: MemoryPatch, selectedOpIds: string[] | undefined, result: MemoryPatch): boolean {
  if (!Array.isArray(result.ops) || !Array.isArray(result.skipped_ops)
    || result.patch_id !== patch.patch_id || result.generated_by !== patch.generated_by
    || result.mode !== patch.mode || JSON.stringify(result.ops) !== JSON.stringify(patch.ops)) return false;
  const selected = selectedOps(patch, selectedOpIds).map((op) => op.op_id);
  const unselected = new Set(result.skipped_ops
    .filter((skip) => skip.reason === "not_selected").map((skip) => skip.op_id));
  const resultSelected = result.ops.filter((op) => !unselected.has(op.op_id)).map((op) => op.op_id);
  return JSON.stringify(selected) === JSON.stringify(resultSelected);
}

export function applyPatch(root: string, patch: MemoryPatch, options: ApplyPatchOptions): MemoryPatch {
  validatePatchId(patch.patch_id);

  const recovery = recoverGovernanceTransactions(root, options.now);
  assertGovernanceRecoveryClear(recovery);

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
    if (legacy?.stage === "complete" && legacy.result
      && matchingLegacyReceipt(patch, options.selectedOpIds, legacy.result)) return legacy.result;
  }

  return runGovernanceTransaction(
    root,
    {
      transactionId: transactionIdForAttempt(root, patch, options.selectedOpIds),
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
