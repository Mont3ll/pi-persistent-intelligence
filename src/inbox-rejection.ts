import type { CaptureCandidate, MemoryPatch } from "./types";

export function buildInboxRejectionPatch(candidates: CaptureCandidate[], now: string): MemoryPatch {
  const pending = candidates.filter((candidate) => candidate.status === "new");
  const stamp = now.replace(/[-:.TZ]/g, "").slice(0, 14);
  return {
    patch_id: `patch_${stamp}_inbox_rejection`,
    created_at: now,
    generated_by: "manual",
    mode: "supervised",
    summary: "Review pending inbox candidates for rejection.",
    ops: pending.map((candidate, index) => ({
      op_id: `op_reject_${String(index + 1).padStart(3, "0")}`,
      op: "reject_candidate",
      candidate_id: candidate.id,
      risk: "low",
      default_selected: false,
    })),
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}
