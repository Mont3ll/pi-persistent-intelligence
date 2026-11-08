import { createHash } from "node:crypto";
import { loadConfig } from "./config";
import { curateInbox } from "./curator";
import { readEvidenceRecords } from "./evidence";
import { readCanonicalGeneration } from "./governance-generation";
import { listCandidates } from "./inbox";
import { applyPatch } from "./patch";
import { materializeSemanticCaptureCandidates } from "./semantic-capture-materialize";
import { proposeSemanticCapturePlan } from "./semantic-capture-plan";
import { semanticCandidateId } from "./semantic-source-binding";
import { issueSemanticAutoPermit } from "./semantic-auto-permit";
import { semanticAutoCurrentStateAllowsNewAdd } from "./semantic-auto-current-state";
import { verifyCandidateTranscriptSource, type TranscriptProofOptions } from "./transcript-proof";
import type { OriginalTurn, SemanticAdapter } from "./semantic-assessment";
import type { MemoryPatch } from "./types";

export interface SemanticAutoPromotionOptions {
  root: string;
  original: OriginalTurn;
  projectId: string;
  now: string;
  adapter: SemanticAdapter;
  trustedTranscriptOptions?: TranscriptProofOptions;
}

export interface SemanticAutoPromotionResult {
  status: "disabled" | "held" | "candidate_created" | "applied";
  reason: string;
  candidates_created: number;
  applied_ops: number;
  /** The result of a real governed transaction, when attempted. */
  receipt?: MemoryPatch;
}

/**
 * Release-gated semantic auto path. No persisted trust bit, model-authored
 * patch, source-aware v1 fallback, or legacy evidence-floor shortcut can
 * authorize an operation. The exact live request must be source-proven,
 * assessed twice, and bound to one low-risk curator-generated L2 add.
 *
 * A second assessment provides a fresh source-bound check, not independent
 * semantic truth; an actual adjudicated model benchmark remains mandatory
 * before this opt-in can be enabled in user sessions.
 */
export async function promoteSemanticTurnAutomatically(
  options: SemanticAutoPromotionOptions,
): Promise<SemanticAutoPromotionResult> {
  const { root, original, projectId, now, adapter } = options;
  const held = (reason: string, candidates_created = 0): SemanticAutoPromotionResult =>
    ({ status: candidates_created ? "candidate_created" : "held",
      reason, candidates_created, applied_ops: 0 });
  const cfg = loadConfig(root);
  if (cfg.curator.semanticAuto !== "guarded-project" || cfg.curator.autoCurate === "off")
    return { status: "disabled", reason: "semantic_auto_off", candidates_created: 0, applied_ops: 0 };
  if (!original.sessionId || original.sessionId === "current-session" || !original.turnId
    || !projectId || !original.text || original.text.length > 32_000)
    return held("invalid_original_turn");

  const first = await proposeSemanticCapturePlan(original, projectId, adapter);
  const firstEntry = first.entries[0];
  if (first.outcome !== "proposed" || first.entries.length !== 1
    || firstEntry?.route !== "durable_candidate"
    || firstEntry.projectId !== projectId) return held("semantic_abstained");

  const materialized = materializeSemanticCaptureCandidates(root, original, first, projectId, now);
  if (materialized.rejected || materialized.created + materialized.already_present !== 1)
    return held("semantic_candidate_not_materialized");
  const created = materialized.created;
  const fullHash = createHash("sha256").update(original.text).digest("hex");
  const candidateId = semanticCandidateId(original.sessionId, original.turnId,
    fullHash, firstEntry.start, firstEntry.end, projectId);
  const candidate = listCandidates(root).find(c => c.id === candidateId && c.status === "new");
  if (!candidate || candidate.evidence_refs.length !== 1) return held("candidate_not_pending", created);
  const evidence = readEvidenceRecords(root).find(e => e.id === candidate.evidence_refs[0]);
  if (!evidence || !verifyCandidateTranscriptSource(
    candidate, evidence, options.trustedTranscriptOptions).verified)
    return held("original_transcript_unverified", created);

  // A curator proposal is bound to the current canonical generation.
  // A model call below may yield to an independent owner transaction.
  // Never sample a newer generation as if this older proposal were fresh.
  const proposalGeneration = readCanonicalGeneration(root);
  if (!semanticAutoCurrentStateAllowsNewAdd(root, candidate))
    return held("canonical_match_or_verification_requires_review", created);

  // Curation is deliberately supervised here: generic auto curation is
  // never allowed to select semantic candidates. This runner selects only
  // its own specifically proven low-risk proposal, then changes to auto
  // mode under an ephemeral permit checked again at governed apply.
  const proposal = curateInbox(root, {
    mode: "supervised", now, governanceMode: cfg.governance.mode,
    minEvidenceCount: 1, trustedTranscriptOptions: options.trustedTranscriptOptions,
  });
  const matches = proposal.ops.filter(op => op.candidate_id === candidateId);
  if (matches.length !== 1) return held("not_single_candidate_proposal", created);
  const selected = matches[0]!;
  if (selected.op !== "add" || selected.risk !== "low"
    || selected.default_selected !== false || selected.record?.layer !== "L2"
    || selected.record.statement !== firstEntry.quote
    || selected.record.scope.type !== "project" || selected.record.scope.project !== projectId
    // Recheck the match/verification decision separately from curator risk:
    // curator can produce risk=low with a manual merge/review rationale.
    || !semanticAutoCurrentStateAllowsNewAdd(root, candidate)
    || readCanonicalGeneration(root) !== proposalGeneration)
    return held("curator_requires_review", created);

  // Freshly recheck semantic attribution before making a governed attempt.
  // No model-provided operation or persisted eligibility field is trusted.
  const second = await proposeSemanticCapturePlan(original, projectId, adapter);
  if (second.outcome !== "proposed" || second.entries.length !== 1
    || JSON.stringify(first.entries) !== JSON.stringify(second.entries))
    return held("fresh_semantic_review_disagreed", created);
  if (readCanonicalGeneration(root) !== proposalGeneration)
    return held("canonical_generation_changed_after_proposal", created);
  if (!semanticAutoCurrentStateAllowsNewAdd(root, candidate))
    return held("canonical_match_or_verification_requires_review", created);
  const autoOp = { ...selected, default_selected: true };
  const autoPatch: MemoryPatch = {
    ...proposal,
    patch_id: proposal.patch_id + "_r4_semantic_auto_" +
      createHash("sha256").update(candidateId).digest("hex").slice(0, 8),
    mode: "auto",
    ops: [autoOp],
    summary: "Single source-grounded R4 semantic project L2 candidate",
  };
  const permit = issueSemanticAutoPermit({
    original, first, second, candidate, evidence, projectId,
    proposalGeneration, patch: autoPatch, op: autoOp,
  });
  if (!permit) return held("semantic_authorization_not_issued", created);

  // At application, the scoped permit, exact proposal snapshot, fresh
  // trusted source, live policy, identity, trust and evidence are checked in
  // the transaction workspace. The expected generation prevents racing an
  // intervening canonical mutation.
  const receipt = applyPatch(root, autoPatch, {
    now, selectedOpIds: [autoOp.op_id],
    expectedGeneration: proposalGeneration,
    trustedTranscriptOptions: options.trustedTranscriptOptions,
    semanticAutoPermit: permit,
  });
  return {
    status: receipt.applied_ops.includes(autoOp.op_id) ? "applied"
      : created ? "candidate_created" : "held",
    reason: receipt.applied_ops.includes(autoOp.op_id) ? "governed_l2_applied"
      : "governed_apply_held",
    candidates_created: created,
    applied_ops: receipt.applied_ops.length,
    receipt,
  };
}
