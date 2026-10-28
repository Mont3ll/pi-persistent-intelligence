import { loadConfig } from "./config";
import { curateInbox } from "./curator";
import { selectInboxBatchApplyOpIds } from "./curation-selection";
import { listCandidates } from "./inbox";
import { applyPatch } from "./patch";
import type { TranscriptProofOptions } from "./transcript-proof";
import type { MemoryPatch } from "./types";

/** Bounded writes per startup; no autonomous bulk history promotion. */
const MAX_RETRY_APPLIED_OPERATIONS = 3;

export interface NextSessionRetryOptions {
  now: string;
  trustedTranscriptOptions?: TranscriptProofOptions;
}

export interface NextSessionRetryResult {
  status: "disabled" | "no_attributable_candidate" | "held" | "applied";
  considered_candidates: number;
  selected_ops: number;
  applied_ops: number;
  skipped_ops: number;
  /** Present only when the guarded transaction was actually attempted. */
  proposed_patch?: MemoryPatch;
  apply_receipt?: MemoryPatch;
}

/**
 * One controlled retry when a new primary Pi session starts.
 *
 * The previous session may have shut down before its original transcript
 * was flushed. We ONLY reconsider already captured, attributable, under-
 * floor user candidates, and only when source-aware auto curation was
 * explicitly enabled. No source identity or proof flag is manufactured.
 *
 * curateInbox recomputes real original-transcript proof; applyPatch
 * revalidates it inside the governance transaction. This helper does not
 * mutate inbox/canonical state except through those existing governed gates.
 *
 * No background timer, auto-config changes, or legacy backfill is performed.
 */
export function retryVerifiedSourceCandidatesAtSessionStart(
  root: string,
  options: NextSessionRetryOptions,
): NextSessionRetryResult {
  const disabled: NextSessionRetryResult = {
    status: "disabled", considered_candidates: 0, selected_ops: 0,
    applied_ops: 0, skipped_ops: 0,
  };
  const config = loadConfig(root);
  if (config.curator.sourceAwareAuto !== "transcript-verified-direct-user"
    || config.curator.autoCurate === "off") return disabled;

  const retryable = listCandidates(root).filter((candidate) =>
    candidate.status === "new"
    && candidate.evidence_refs.length === 1
    && candidate.capture_source?.identity_quality === "observed_session_id"
    && (candidate.source.type === "direct_user_instruction"
      || candidate.source.type === "user_correction")
  );
  if (!retryable.length) return {
    status: "no_attributable_candidate", considered_candidates: 0,
    selected_ops: 0, applied_ops: 0, skipped_ops: 0,
  };

  // Same full configured trust/verification/capture-policy/matching gates as
  // shutdown curation. The candidate set below only narrows what can be
  // applied; it never grants source authority.
  const patch = curateInbox(root, {
    now: options.now, mode: "auto",
    governanceMode: config.governance.mode,
    vaultPath: config.vault.path ?? undefined,
    trustedTranscriptOptions: options.trustedTranscriptOptions,
  });
  const targetIds = new Set(retryable.map((candidate) => candidate.id));
  const threshold = config.curator.autoCurate === "high-only"
    ? config.curator.autoCurateHighThreshold
    : config.curator.minConfidence;
  const safeIds = new Set(selectInboxBatchApplyOpIds(patch, threshold));
  const selectedOpIds = patch.ops.filter((op) =>
    op.candidate_id && targetIds.has(op.candidate_id) && safeIds.has(op.op_id))
    .slice(0, MAX_RETRY_APPLIED_OPERATIONS)
    .map((op) => op.op_id);

  if (!selectedOpIds.length) return {
    status: "held", considered_candidates: retryable.length,
    selected_ops: 0, applied_ops: 0, skipped_ops: 0,
  };

  const applied = applyPatch(root, patch, {
    now: options.now,
    selectedOpIds,
    trustedTranscriptOptions: options.trustedTranscriptOptions,
  });
  return {
    status: applied.applied_ops.length ? "applied" : "held",
    considered_candidates: retryable.length,
    selected_ops: selectedOpIds.length,
    applied_ops: applied.applied_ops.length,
    skipped_ops: applied.skipped_ops.filter((skip) => selectedOpIds.includes(skip.op_id)).length,
    proposed_patch: patch,
    apply_receipt: applied,
  };
}
