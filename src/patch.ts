import { basename } from "node:path";
import { applyPatchDirect } from "./patch-direct";
import { runGovernanceTransaction, type GovernanceTransactionStage } from "./governance-transaction";
import type { MemoryPatch } from "./types";

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

export function applyPatch(root: string, patch: MemoryPatch, options: ApplyPatchOptions): MemoryPatch {
  validatePatchId(patch.patch_id);
  return runGovernanceTransaction(
    root,
    {
      transactionId: patch.patch_id,
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
