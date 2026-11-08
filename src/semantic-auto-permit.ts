import { createHash } from "node:crypto";
import type { CaptureCandidate, EvidenceRecord, MemoryPatch, PatchOp } from "./types";
import type { OriginalTurn } from "./semantic-assessment";
import type { SemanticCapturePlan } from "./semantic-capture-plan";

/**
 * Single-invocation, in-memory authorization for the narrowly vetted R4
 * semantic auto path. The token is never JSON-serialized or stored in the
 * inbox, evidence, patch, model response or a governance receipt.
 *
 * This is a trusted-extension control, NOT an OS/process sandbox against
 * arbitrary code with write access to the PI store.
 */
const permits = new WeakMap<object, Readonly<{
  opDigest: string;
  candidateId: string;
  sourceHash: string;
  sessionId: string;
  turnId: string;
  projectId: string;
  proposalGeneration: number;
  issuedAtMs: number;
}>>();
const MAX_PERMIT_AGE_MS = 60_000;
const opDigest = (op: PatchOp): string =>
  createHash("sha256").update(JSON.stringify(op)).digest("hex");

export interface SemanticAutoPermit {
  /** Phantom property prevents normal structural construction in TS callers. */
  readonly __piSemanticAutoCapability: never;
}

/** Mint only after a trusted coordinator receives two matching validated semantic plans. */
export function issueSemanticAutoPermit(input: {
  original: OriginalTurn;
  first: SemanticCapturePlan;
  second: SemanticCapturePlan;
  candidate: CaptureCandidate;
  evidence: EvidenceRecord;
  projectId: string;
  proposalGeneration: number;
  patch: MemoryPatch;
  op: PatchOp;
}): SemanticAutoPermit | null {
  const { original, first, second, candidate, evidence, projectId, proposalGeneration, patch, op } = input;
  const hash = createHash("sha256").update(original.text).digest("hex");
  const expectedPlan = (plan: SemanticCapturePlan): boolean => {
    const entry = plan.entries[0];
    return plan.outcome === "proposed" && plan.entries.length === 1
      && plan.sourceSessionId === original.sessionId
      && plan.sourceTurnId === original.turnId
      && plan.sourceSha256 === hash
      && entry?.route === "durable_candidate"
      && entry.reason === "direct_standing_project_rule"
      && entry.projectId === projectId
      && entry.originalSourceSha256 === hash
      && entry.automaticPromotionAuthorized === false
      && original.text.slice(entry.start, entry.end) === entry.quote;
  };
  if (!Number.isSafeInteger(proposalGeneration) || proposalGeneration < 0
    || !expectedPlan(first) || !expectedPlan(second)
    || JSON.stringify(first.entries) !== JSON.stringify(second.entries)
    || patch.generated_by !== "curator" || patch.mode !== "auto"
    || patch.ops.length !== 1 || patch.ops[0] !== op
    || op.op !== "add" || op.risk !== "low" || op.default_selected !== true
    || !op.record || op.record.layer !== "L2"
    || op.record.statement !== first.entries[0]!.quote
    || op.record.scope.type !== "project" || op.record.scope.project !== projectId
    || op.candidate_id !== candidate.id || !candidate.id.startsWith("cap_sem_")
    || candidate.capture_source?.version !== 2
    || candidate.capture_source.session_id !== original.sessionId
    || candidate.capture_source.turn_id !== original.turnId
    || candidate.capture_source.original_message_sha256 !== hash
    || evidence.source_session_id !== original.sessionId
    || evidence.source_turn_id !== original.turnId
    || evidence.source_message_sha256 !== hash
    || candidate.evidence_refs.length !== 1
    || candidate.evidence_refs[0] !== evidence.id) return null;

  const permit = Object.freeze({}) as SemanticAutoPermit;
  permits.set(permit, Object.freeze({
    opDigest: opDigest(op), candidateId: candidate.id,
    sourceHash: hash, sessionId: original.sessionId,
    turnId: original.turnId, projectId, proposalGeneration,
    issuedAtMs: Date.now(),
  }));
  return permit;
}

/** Negative-only check. A permit never replaces fresh original transcript proof. */
export function permitsSemanticAutoOperation(
  permit: SemanticAutoPermit | undefined,
  op: PatchOp,
  candidate: CaptureCandidate,
  canonicalGeneration: number,
): boolean {
  if (!permit || typeof permit !== "object") return false;
  const issued = permits.get(permit);
  const source = candidate.capture_source;
  if (!issued || !source || source.version !== 2
    || Date.now() < issued.issuedAtMs
    || Date.now() - issued.issuedAtMs > MAX_PERMIT_AGE_MS) return false;
  return issued.proposalGeneration === canonicalGeneration
    && issued.opDigest === opDigest(op)
    && issued.candidateId === candidate.id
    && issued.sessionId === source.session_id
    && issued.turnId === source.turn_id
    && issued.sourceHash === source.original_message_sha256
    && candidate.scope_targets?.length === 1
    && candidate.scope_targets[0]?.type === "project"
    && candidate.scope_targets[0].project === issued.projectId;
}
