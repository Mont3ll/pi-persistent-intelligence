import { createHash } from "node:crypto";
import {
  proposeSemanticReview,
  type OriginalTurn, type SemanticAdapter,
  type SemanticReview, type SemanticProposition,
} from "./semantic-assessment";

/**
 * Authenticated semantic propositions are distinct from candidate authority.
 * This module neither writes the inbox nor grants automatic patch selection.
 * The original Pi transcript, project identity and apply-time policy still
 * need independent verification before any L2 promotion.
 */
export type SemanticCaptureRoute =
  | "durable_candidate"
  | "review_required"
  | "daily_only"
  | "not_memory";
export type SemanticCaptureReason =
  | "direct_standing_project_rule"
  | "global_requires_review"
  | "unknown_scope_or_duration"
  | "not_directly_endorsed"
  | "time_bounded"
  | "uncertain_disposition"
  | "multi_proposition_requires_review"
  | "oversized_proposition"
  | "model_abstained"
  | "untrusted_source";

export interface SemanticCaptureEntry {
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly route: SemanticCaptureRoute;
  readonly reason: SemanticCaptureReason;
  /** Candidate source span, never model-authorized promotion. */
  readonly originalSourceSha256: string;
  readonly projectId?: string;
  readonly automaticPromotionAuthorized: false;
}
export interface SemanticCapturePlan {
  readonly sourceSessionId: string;
  readonly sourceTurnId: string;
  readonly sourceSha256: string;
  readonly outcome: "proposed" | "abstain";
  readonly entries: readonly SemanticCaptureEntry[];
  readonly canonicalWrites: 0;
  readonly automaticPromotionAuthorized: false;
}

const digest = (text: string): string => createHash("sha256").update(text).digest("hex");

function route(p: SemanticProposition, mixed: boolean): [SemanticCaptureRoute, SemanticCaptureReason] {
  if (p.endorsement !== "direct_user") return ["review_required", "not_directly_endorsed"];
  if (p.disposition === "uncertain") return ["review_required", "uncertain_disposition"];
  if (p.disposition === "not_memory") return ["not_memory", "uncertain_disposition"];
  if (p.disposition === "temporary" || p.duration === "bounded"
    || p.scope === "session") return ["daily_only", "time_bounded"];
  if (p.duration !== "standing" || p.scope === "unknown")
    return ["review_required", "unknown_scope_or_duration"];
  if (p.scope === "global") return ["review_required", "global_requires_review"];
  if (mixed) return ["review_required", "multi_proposition_requires_review"];
  if (p.quote.length > 300) return ["review_required", "oversized_proposition"];
  return ["durable_candidate", "direct_standing_project_rule"];
}

/**
 * A candidate route is deliberately weaker than automatic authorization.
 * The single-proposition fast path lets a future governed auto-promoter act
 * only after it verifies original transcript proof and a fresh semantic gate.
 */
export function planSemanticCapture(
  original: OriginalTurn,
  reviewed: SemanticReview,
  projectId: string,
): SemanticCapturePlan {
  const sourceSha256 = digest(original.text);
  const base = {
    sourceSessionId: original.sessionId,
    sourceTurnId: original.turnId,
    sourceSha256,
    canonicalWrites: 0 as const,
    automaticPromotionAuthorized: false as const,
  };
  if (!original.sessionId || !original.turnId || !projectId
    || reviewed.status !== "proposal_only" || reviewed.result.sourceHash !== sourceSha256) {
    return Object.freeze({
      ...base, outcome: "abstain", entries: Object.freeze([]),
    });
  }
  const ps = reviewed.result.propositions;
  const mixed = ps.length !== 1;
  const entries: SemanticCaptureEntry[] = [];
  for (const p of ps) {
    if (original.text.slice(p.start, p.end) !== p.quote) {
      return Object.freeze({ ...base, outcome: "abstain", entries: Object.freeze([]) });
    }
    const [proposedRoute, proposedReason] = route(p, mixed);
    entries.push(Object.freeze({
      start: p.start,
      end: p.end,
      quote: p.quote,
      route: proposedRoute,
      reason: proposedReason,
      originalSourceSha256: sourceSha256,
      ...(p.scope === "project" ? { projectId } : {}),
      automaticPromotionAuthorized: false as const,
    }));
  }
  return Object.freeze({ ...base, outcome: "proposed", entries: Object.freeze(entries) });
}

export async function proposeSemanticCapturePlan(
  original: OriginalTurn,
  projectId: string,
  adapter: SemanticAdapter,
): Promise<SemanticCapturePlan> {
  const assessed = await proposeSemanticReview(original, adapter);
  return planSemanticCapture(original, assessed, projectId);
}
