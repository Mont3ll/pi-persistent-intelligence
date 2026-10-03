import type { MemoryPatch } from "./types";

export function selectInboxBatchApplyOpIds(patch: MemoryPatch, confidenceThreshold: number): string[] {
  return patch.ops
    .filter((op) => {
      if (op.default_selected !== true || op.risk === "high") return false;
      const confidence = op.record?.confidence ?? op.to_record?.confidence ?? 0;
      return confidence >= confidenceThreshold;
    })
    .map((op) => op.op_id);
}
