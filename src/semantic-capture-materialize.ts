import { createHash } from "node:crypto";
import { buildSemanticCaptureSourceAttribution } from "./capture-provenance";
import { appendEvidenceRecord } from "./evidence";
import { appendOrReinforceCandidate, normalizedPreferenceKey } from "./capture-recurrence";
import { listCandidates } from "./inbox";
import { scoreMemoryWorth } from "./memory-worth";
import { scanSecrets, shouldBlockPersistence } from "./secret-scanner";
import { buildCandidateTrustMetadata } from "./trust";
import type { OriginalTurn } from "./semantic-assessment";
import type { SemanticCapturePlan } from "./semantic-capture-plan";
import type { CaptureCandidate } from "./types";

export interface SemanticMaterializationSummary {
  created: number;
  already_present: number;
  held: number;
  rejected: number;
  canonical_writes: 0;
}

/**
 * Persist semantic propositions as candidate + provenance ONLY.
 *
 * This does not issue curator patches or enable automatic promotion. Trusted
 * transcript proof is checked independently later; the model's "durable"
 * label never becomes a stored permission. Existing candidates are retained
 * idempotently instead of duplicating evidence on each analysis retry.
 */
export function materializeSemanticCaptureCandidates(
  root: string,
  original: OriginalTurn,
  plan: SemanticCapturePlan,
  verifiedProjectId: string,
  now: string,
): SemanticMaterializationSummary {
  const result: SemanticMaterializationSummary = {
    created: 0, already_present: 0, held: 0, rejected: 0, canonical_writes: 0,
  };
  const fullHash = createHash("sha256").update(original.text).digest("hex");
  if (!original.sessionId || !original.turnId || !verifiedProjectId
    || plan.sourceSessionId !== original.sessionId
    || plan.sourceTurnId !== original.turnId
    || plan.sourceSha256 !== fullHash || plan.outcome !== "proposed"
    || shouldBlockPersistence(scanSecrets(original.text))) {
    return { ...result, rejected: plan.entries.length || 1 };
  }
  const current = new Set(listCandidates(root).map(candidate => candidate.id));
  for (const entry of plan.entries) {
    if (entry.route !== "durable_candidate" || entry.automaticPromotionAuthorized
      || entry.projectId !== verifiedProjectId
      || entry.originalSourceSha256 !== fullHash
      || !Number.isSafeInteger(entry.start) || !Number.isSafeInteger(entry.end)
      || entry.start < 0 || entry.end <= entry.start || entry.end > original.text.length
      || original.text.slice(entry.start, entry.end) !== entry.quote
      || entry.quote.length > 300) {
      result.held++;
      continue;
    }
    const id = "cap_sem_" + createHash("sha256")
      .update(JSON.stringify([original.sessionId, original.turnId, fullHash,
        entry.start, entry.end, verifiedProjectId])).digest("hex").slice(0, 24);
    if (current.has(id)) {
      result.already_present++;
      continue;
    }
    const worth = scoreMemoryWorth({
      observation: entry.quote,
      explicitUserRequest: true,
      durability: "project", scope: verifiedProjectId,
      evidenceStrength: 0.9, operationalImpact: 0.8,
    });
    if (worth.decision !== "candidate") {
      result.held++;
      continue;
    }
    const capturedSource = buildSemanticCaptureSourceAttribution(
      original.sessionId, original.turnId, original.text, entry.start, entry.end);
    const sourceRef = `session:${original.sessionId}:turn:${original.turnId}`;
    const ev = appendEvidenceRecord(root, {
      id: "", resource_id: "curation", profile_id: "legacy-default",
      created_at: now, source_kind: "conversation",
      source_session_id: original.sessionId, source_turn_id: original.turnId,
      source_message_sha256: fullHash,
      source_identity_quality: capturedSource.identity_quality,
      source_ref: sourceRef, source_summary: entry.quote,
      trust_class: "direct_user_instruction", polarity: "supports",
      durability_signal: "project", related_memory_ids: [],
      scope_level: "project", scope_ref: verifiedProjectId,
      tags: ["semantic-capture", "source-span-v2"],
      notes: "capture_evidence_semantic_v1",
    });
    const trust = buildCandidateTrustMetadata("direct_user_instruction", "project");
    const candidate: CaptureCandidate = {
      id, created_at: now,
      source: { type: "direct_user_instruction", ref: sourceRef },
      text: entry.quote, tags: ["capture", "project_convention", "semantic-proposition"],
      evidence_refs: [ev.id], evidence_ids: [ev.id],
      confidence: 0.9, status: "new", ruleType: "convention",
      memory_kind: "instruction", worth_decision: worth.decision,
      worth_score: worth.worth_score, worth_reasons: worth.reasons,
      ...trust,
      // No model-derived authority; subsequent independently verified
      // transcript and fresh semantic policy must grant it separately.
      promotion_eligibility: "review_only",
      capture_source: capturedSource,
      capture_intent: "project_convention",
      scope_targets: [{
        type: "project", project: verifiedProjectId,
        confidence: 0.9, basis: ["semantic_source_span", "requires_transcript_proof"],
      }],
      normalized_preference_key: normalizedPreferenceKey(entry.quote, "project_convention"),
      source_session_ids: [original.sessionId],
      source_turn_ids: [`${original.sessionId}:${original.turnId}`],
    };
    appendOrReinforceCandidate(root, candidate);
    current.add(id);
    result.created++;
  }
  return result;
}
