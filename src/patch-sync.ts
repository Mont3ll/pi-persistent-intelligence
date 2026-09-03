import { applyPatch, type ApplyPatchOptions } from "./patch";
import { runFtsAwarePostMutationChecksAfterSync } from "./post-mutation-checks";
import { syncFtsIndex } from "./retriever";
import type { MemoryFtsIndex } from "./search/fts";
import type { MemoryPatch } from "./types";

export function applyPatchAndSync(root: string, patch: MemoryPatch, options: ApplyPatchOptions, ftsIndex: MemoryFtsIndex): MemoryPatch {
  const result = applyPatch(root, patch, options);
  syncFtsIndex(root, ftsIndex);
  const appliedOps = patch.ops.filter((operation) => result.applied_ops.includes(operation.op_id));
  runFtsAwarePostMutationChecksAfterSync({ root, patchId: patch.patch_id, ops: appliedOps, ftsIndex });
  return result;
}
