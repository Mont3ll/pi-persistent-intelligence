import type { CaptureCandidate, MemoryPatch } from "./types";
import { selectInboxBatchApplyOpIds } from "./curation-selection";

export interface InboxCurationSummary {
  pending: number;
  proposals: number;
  safe_auto_ops: number;
  review_only_ops: number;
  below_confidence: number;
  below_evidence: number;
  no_materialized_op: number;
}

export function summarizeInboxCuration(
  candidates: CaptureCandidate[],
  patch: MemoryPatch,
  minConfidence: number,
  minEvidence: number,
  autoThreshold: number,
): InboxCurationSummary {
  const pending = candidates.filter((candidate) => candidate.status === "new");
  const proposalIds = new Set(patch.ops.map((op) => op.candidate_id).filter((id): id is string => Boolean(id)));
  const safe = selectInboxBatchApplyOpIds(patch, autoThreshold);
  return {
    pending: pending.length,
    proposals: patch.ops.length,
    safe_auto_ops: safe.length,
    review_only_ops: patch.ops.length - safe.length,
    below_confidence: pending.filter((candidate) => (candidate.confidence ?? 0) < minConfidence).length,
    below_evidence: pending.filter((candidate) => candidate.evidence_refs.length < minEvidence).length,
    no_materialized_op: pending.filter((candidate) =>
      (candidate.confidence ?? 0) >= minConfidence
      && candidate.evidence_refs.length >= minEvidence
      && !proposalIds.has(candidate.id)
    ).length,
  };
}

export function renderInboxCurationSummary(s: InboxCurationSummary): string {
  return `Inbox ${s.pending} pending: ${s.safe_auto_ops} auto-eligible operations, ${s.review_only_ops} review-only proposals, ${s.below_confidence} below confidence floor, ${s.below_evidence} below evidence minimum, ${s.no_materialized_op} without a new materializable operation. Counts can overlap. Held candidates require review or verifiable evidence; no governance gate was bypassed.`;
}
