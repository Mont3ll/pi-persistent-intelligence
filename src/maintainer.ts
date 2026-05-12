import { loadActiveRecords } from "./store";
import type { MemoryPatch, PatchOp } from "./types";

interface MaintainOptions {
  now: string;
  mode: "propose" | "supervised" | "auto";
  semiStableDecay?: number;
  stableDecay?: number;
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function isOverdue(nextReview: string, today: string): boolean {
  return nextReview < today;
}

export function maintainMemory(root: string, options: MaintainOptions): MemoryPatch {
  const today = dateOnly(options.now);
  const ops: PatchOp[] = [];
  for (const record of loadActiveRecords(root)) {
    if (!isOverdue(record.review.next_review, today)) continue;
    const decay = record.stability === "stable" ? options.stableDecay ?? 0.05 : options.semiStableDecay ?? 0.15;
    const confidence = Math.max(0, Number((record.confidence - decay).toFixed(2)));
    ops.push({
      op_id: `op_${String(ops.length + 1).padStart(3, "0")}`,
      op: "decay",
      target_id: record.id,
      updates: { confidence, updated_at: today },
      reason: `Review date ${record.review.next_review} is overdue as of ${today}.`,
      rationale: `Decay confidence from ${record.confidence} to ${confidence}.`,
      risk: record.layer === "L1" ? "medium" : "low",
      default_selected: record.layer !== "L1",
    });
  }
  const stamp = options.now.replace(/[-:T]/g, "").slice(0, 12);
  return {
    patch_id: `patch_${stamp}_maintain_001`,
    created_at: options.now,
    generated_by: "maintainer",
    mode: options.mode,
    summary: ops.length ? `Decay ${ops.length} overdue memory record(s).` : "No maintenance operations required.",
    ops,
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}
