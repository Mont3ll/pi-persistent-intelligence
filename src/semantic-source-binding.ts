import { createHash } from "node:crypto";
import type { CaptureCandidate, EvidenceRecord, PatchOp } from "./types";

/**
 * Source-v2 candidate and evidence IDs are content-addressed to the ORIGINAL
 * semantic proposition. These formulas are shared by capture and governed
 * application: changing mutable turn metadata cannot rebind an old ID to a
 * different same-text user turn.
 */
export function semanticCandidateId(
  sessionId: string,
  turnId: string,
  fullMessageHash: string,
  start: number,
  end: number,
  projectId: string,
): string {
  return "cap_sem_" + createHash("sha256")
    .update(JSON.stringify([sessionId, turnId, fullMessageHash, start, end, projectId]))
    .digest("hex").slice(0, 24);
}

export function semanticEvidenceId(
  candidateId: string,
  fullMessageHash: string,
  start: number,
  end: number,
): string {
  return "ev_sem_" + createHash("sha256")
    .update(JSON.stringify([candidateId, fullMessageHash, start, end]))
    .digest("hex").slice(0, 24);
}

/**
 * Fail closed unless the current candidate, independent stored evidence and
 * ORIGINAL curator proposal all describe the same source identity and span.
 *
 * This rejects the source-A -> same-text source-B relabel attack even when
 * both current candidate and current evidence have been rewritten together.
 * The candidate/evidence IDs cannot be changed without breaking the original
 * proposal ID and source-derivation constraints.
 *
 * No model output or source verification flags are taken as write authority.
 * A fresh trusted transcript proof is still required independently.
 */
export function semanticProposalSourceBindingMatches(
  candidate: CaptureCandidate,
  evidence: EvidenceRecord | undefined,
  op: PatchOp,
): boolean {
  const source = candidate.capture_source;
  if (!source || source.version !== 2 || !evidence
    || source.policy_version !== "capture-semantic-v1"
    || source.identity_quality !== "observed_session_id"
    || !source.session_id || !source.turn_id
    || !/^[a-f0-9]{64}$/.test(source.original_message_sha256)
    || !Number.isSafeInteger(source.proposition_start)
    || !Number.isSafeInteger(source.proposition_end)
    || source.proposition_start < 0
    || source.proposition_end <= source.proposition_start
    || source.proposition_end > source.original_character_count
    || source.proposition_end - source.proposition_start !== candidate.text.length
    || candidate.text.length > 300) return false;

  const target = candidate.scope_targets?.length === 1 ? candidate.scope_targets[0] : undefined;
  if (!target || target.type !== "project" || !target.project) return false;

  const expectedCandidateId = semanticCandidateId(
    source.session_id, source.turn_id, source.original_message_sha256,
    source.proposition_start, source.proposition_end, target.project,
  );
  const expectedEvidenceId = semanticEvidenceId(
    expectedCandidateId, source.original_message_sha256,
    source.proposition_start, source.proposition_end,
  );
  const expectedRef = `session:${source.session_id}:turn:${source.turn_id}`;

  if (candidate.id !== expectedCandidateId || op.candidate_id !== expectedCandidateId
    || evidence.id !== expectedEvidenceId
    || candidate.evidence_refs?.length !== 1
    || candidate.evidence_ids?.length !== 1
    || candidate.evidence_refs[0] !== expectedEvidenceId
    || candidate.evidence_ids[0] !== expectedEvidenceId
    || candidate.source.ref !== expectedRef
    || evidence.source_ref !== expectedRef
    || evidence.source_session_id !== source.session_id
    || evidence.source_turn_id !== source.turn_id
    || evidence.source_message_sha256 !== source.original_message_sha256
    || evidence.source_summary !== candidate.text
    || evidence.scope_level !== "project"
    || evidence.scope_ref !== target.project
    || evidence.source_kind !== "conversation"
    || evidence.notes !== "capture_evidence_semantic_v1"
    || evidence.polarity !== "supports"
    || evidence.redaction_status === "deleted"
    || evidence.redaction_status === "redacted"
    || op.op !== "add"
    || !op.record || op.record.statement !== candidate.text
    || op.record.scope.type !== "project"
    || op.record.scope.project !== target.project
    || !op.record.evidence.some(ref => ref.ref === expectedEvidenceId)) return false;

  // This is the source snapshot captured when the genuine curator proposal
  // was assembled. Changing the stored evidence to turn B must not silently
  // change what a reviewer selected for turn A.
  const snapshots = op.supportingEvidence?.filter(item => item.id === expectedEvidenceId) ?? [];
  if (snapshots.length !== 1) return false;
  const snapshot = snapshots[0]!;
  return snapshot.source_session_id === source.session_id
    && snapshot.source_turn_id === source.turn_id
    && snapshot.source_message_sha256 === source.original_message_sha256
    && snapshot.source_ref === expectedRef
    && snapshot.source_summary === candidate.text
    && snapshot.scope_level === "project"
    && snapshot.scope_ref === target.project
    && snapshot.id === evidence.id
    && snapshot.notes === "capture_evidence_semantic_v1"
    && snapshot.source_kind === "conversation";
}
