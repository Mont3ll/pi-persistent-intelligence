import type { CaptureCandidate, EvidenceRecord } from "./types";

/**
 * A proposal-only semantic source must remain review-only even when an older
 * recurrence path combines evidence references or mutable candidate metadata
 * is lost. Never use a confidence, recurrence count or stored permission flag
 * as evidence that source-v2 semantics were authorized to auto-promote.
 *
 * Historical/corrupted source-v2 descendants may lack capture_source. Check
 * stable candidate IDs and separately persisted evidence lineage as well.
 * This classification is fail-closed; it grants no positive permissions.
 */
export function hasSemanticReviewLineage(
  candidate: CaptureCandidate,
  evidenceRecords: readonly EvidenceRecord[] = [],
): boolean {
  if (candidate.id.startsWith("cap_sem_") || candidate.capture_source?.version === 2
    || candidate.tags?.includes("semantic-proposition")
    || candidate.scope_targets?.some(scope => scope.basis?.includes("semantic_source_span"))) {
    return true;
  }
  const refs = new Set([...(candidate.evidence_refs ?? []), ...(candidate.evidence_ids ?? [])]);
  return evidenceRecords.some(ev =>
    (ev.notes === "capture_evidence_semantic_v1"
      || ev.tags?.includes("source-span-v2")
      || ev.id.startsWith("ev_sem_"))
    && (refs.has(ev.id)
      || (Boolean(candidate.source.ref) && ev.source_ref === candidate.source.ref)));
}
