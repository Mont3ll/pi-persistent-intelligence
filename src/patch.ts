import { applyPatchDirect } from "./patch-direct";
import { assertGovernanceRecoveryClear, recoverGovernanceTransactions } from "./governance-recovery";
import { runGovernanceTransaction, type GovernanceTransactionStage } from "./governance-transaction";
import type { MemoryPatch } from "./types";

export { listPatchFiles, readPatchFile, writePatchFile } from "./patch-direct";

export interface ApplyPatchOptions {
  selectedOpIds?: string[];
  now: string;
  expectedGeneration?: number;
  faultAfterStage?: GovernanceTransactionStage;
}

export function applyPatch(root: string, patch: MemoryPatch, options: ApplyPatchOptions): MemoryPatch {
  const recovery = recoverGovernanceTransactions(root, options.now);
  assertGovernanceRecoveryClear(recovery);
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
