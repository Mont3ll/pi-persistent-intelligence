import { appendEvidenceRecord } from "./evidence";
import { appendCandidate, withMemoryWorth } from "./inbox";
import { buildCandidateTrustMetadata } from "./trust";
import { attachVerification } from "./verifier";
import { scoreMemoryWorth } from "./memory-worth";
import { upsertInquiryRecord } from "./inquiries";
import { createCompactionArtifact, saveCompactionArtifact } from "./compaction-artifacts";
import type { CaptureCandidate, ConsolidationTrigger, DurabilitySignal, EvidenceTrustClass } from "./types";

export interface ContextCompactionObservation {
  text: string;
  tags?: string[];
  trust_class: EvidenceTrustClass;
  durability_signal: DurabilitySignal;
}

export interface ContextCompactionInput {
  resource_id: string;
  profile_id: string;
  thread_id: string;
  cwd?: string;
  now?: string;
  observations: ContextCompactionObservation[];
}

export interface ContextCompactionResult {
  trigger: ConsolidationTrigger;
  evidence_created: number;
  candidates_added: number;
  candidates_rejected: number;
  candidates_rejected_worth?: number;
  candidates_daily_only?: number;
  inquiries_created?: number;
  compaction_artifacts_created?: number;
  compaction_artifact_ids?: string[];
}

function idSafe(input: string): string {
  return input.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "candidate";
}

export function runContextCompactionConsolidation(root: string, input: ContextCompactionInput): ContextCompactionResult {
  const now = input.now ?? new Date().toISOString();
  let evidenceCreated = 0;
  let candidatesAdded = 0;
  let candidatesRejected = 0;
  let candidatesRejectedWorth = 0;
  let candidatesDailyOnly = 0;
  let inquiriesCreated = 0;
  const artifact = createCompactionArtifact({
    compacted_text: input.observations.map((obs) => obs.text).join("\n"),
    original_source_text: input.observations.map((obs) => obs.text).join("\n"),
    source_session_ids: [input.thread_id],
    source_evidence_ids: [],
    compression_method: "structured",
    retrieval_hint: input.observations.flatMap((obs) => obs.tags ?? []).join(", "),
    created_at: now,
  });
  saveCompactionArtifact(root, artifact);

  for (const [index, observation] of input.observations.entries()) {
    const evidence = appendEvidenceRecord(root, {
      id: "",
      resource_id: input.resource_id,
      profile_id: input.profile_id,
      thread_id: input.thread_id,
      created_at: now,
      source_kind: "conversation",
      source_ref: `context_compaction:${artifact.compaction_id}:${index}`,
      source_summary: observation.text,
      source_excerpt: observation.text,
      trust_class: observation.trust_class,
      polarity: "supports",
      durability_signal: observation.durability_signal,
      related_memory_ids: [],
      tags: observation.tags ?? [],
      notes: `compaction_id=${artifact.compaction_id}; original_digest=${artifact.original_digest}; reversible=${artifact.reversible}`,
    });
    evidenceCreated++;

    const worth = scoreMemoryWorth({ observation: observation.text, explicitUserRequest: observation.trust_class === "direct_user_instruction" || observation.trust_class === "user_correction", evidenceStrength: 0.8, operationalImpact: observation.tags?.some((tag) => /testing|workflow|release|security/.test(tag)) ? 0.8 : undefined, durability: observation.durability_signal === "temporary" ? "temporary" : observation.durability_signal === "task" ? "task" : "project", scope: input.profile_id });
    if (worth.decision === "reject") {
      candidatesRejectedWorth++;
      continue;
    }
    if (worth.decision === "daily_only") {
      candidatesDailyOnly++;
      continue;
    }
    if (worth.decision === "inquiry") {
      upsertInquiryRecord(root, { question: observation.text, profile_id: input.profile_id, session_id: input.thread_id, now });
      inquiriesCreated++;
      continue;
    }

    const candidate: CaptureCandidate = attachVerification(root, withMemoryWorth({
      id: `cap_compact_${idSafe(evidence.id)}`,
      resource_id: input.resource_id,
      profile_id: input.profile_id,
      thread_id: input.thread_id,
      created_at: now,
      source: { type: "context_compaction", ref: evidence.id, cwd: input.cwd },
      text: observation.text,
      tags: observation.tags ?? [],
      evidence_refs: [evidence.id],
      evidence_ids: [evidence.id],
      confidence: observation.trust_class === "direct_user_instruction" || observation.trust_class === "user_correction" ? 0.9 : 0.75,
      worth_decision: worth.decision,
      worth_score: worth.worth_score,
      worth_reasons: [...worth.reasons, `compaction_id:${artifact.compaction_id}`, `original_digest:${artifact.original_digest}`],
      status: "new",
      ...buildCandidateTrustMetadata(observation.trust_class, observation.durability_signal),
    }));

    if (candidate.verification_status === "rejected") candidatesRejected++;
    appendCandidate(root, candidate);
    candidatesAdded++;
  }

  return { trigger: "context_compaction", evidence_created: evidenceCreated, candidates_added: candidatesAdded, candidates_rejected: candidatesRejected, candidates_rejected_worth: candidatesRejectedWorth, candidates_daily_only: candidatesDailyOnly, inquiries_created: inquiriesCreated, compaction_artifacts_created: 1, compaction_artifact_ids: [artifact.compaction_id] };
}
