import { basename } from "node:path";
import { readCanonicalGeneration } from "./governance-generation";
import { applyPatchDirect } from "./patch-direct";
import { assertGovernanceRecoveryClear, recoverGovernanceTransactions } from "./governance-recovery";
import { readTransactionManifest, runGovernanceTransaction, type GovernanceTransactionStage } from "./governance-transaction";
import type { MemoryPatch, PatchOp } from "./types";

export { listPatchFiles, readPatchFile, writePatchFile } from "./patch-direct";

export interface ApplyPatchOptions {
  selectedOpIds?: string[];
  now: string;
  expectedGeneration?: number;
  faultAfterStage?: GovernanceTransactionStage;
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

function transactionIdForAttempt(root: string, patch: MemoryPatch, selectedOpIds?: string[]): string {
  if (mayReplayCompletedReceipt(patch, selectedOpIds)) return patch.patch_id;
  return `${patch.patch_id}.g${readCanonicalGeneration(root)}`;
}

export function applyPatch(root: string, patch: MemoryPatch, options: ApplyPatchOptions): MemoryPatch {
  validatePatchId(patch.patch_id);

  const recovery = recoverGovernanceTransactions(root, options.now);
  assertGovernanceRecoveryClear(recovery);

  const recoveredTransactionId = recovery.completed.find((transactionId) =>
    transactionId === patch.patch_id || transactionId.startsWith(`${patch.patch_id}.g`)
  );
  if (recoveredTransactionId) {
    const recovered = readTransactionManifest(root, recoveredTransactionId);
    if (recovered?.stage === "complete" && recovered.result) return recovered.result;
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
    }),
  );
}
