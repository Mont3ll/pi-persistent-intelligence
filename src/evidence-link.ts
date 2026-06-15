import { appendDailyLog, todayString } from "./daily";
import { findEvidenceById } from "./evidence";
import { appendCandidate } from "./inbox";
import { upsertInquiryRecord } from "./inquiries";
import { inferMemoryKind } from "./memory-kind";
import { scoreMemoryWorth } from "./memory-worth";
import { redactSecrets } from "./secret-scanner";
import { buildCandidateTrustMetadata } from "./trust";
import { attachVerification } from "./verifier";
import { computeCandidateConfidence } from "./confidence";
import type { CaptureCandidate, MemoryKind, MemoryLayer } from "./types";

export interface LinkEvidenceInput {
  evidence_id: string;
  statement: string;
  kind?: MemoryKind;
  layer?: MemoryLayer;
  tags?: string[];
  scope?: string;
  confidence?: number;
  forceReview?: boolean;
  now?: string;
  cwd?: string;
}

export interface LinkEvidenceResult {
  status: "candidate_created" | "rejected" | "daily_only" | "inquiry_created" | "failed";
  message: string;
  candidate?: CaptureCandidate;
  inquiry_id?: string;
  evidence_id?: string;
  worth_decision?: string;
  worth_reasons?: string[];
}

function safeId(value: string): string { return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "evidence"; }
function trustDurability(evidenceDurability: string | undefined): any { return evidenceDurability === "temporary" || evidenceDurability === "session" ? evidenceDurability : evidenceDurability === "task" ? "task" : "project"; }

export function linkEvidenceToCandidate(root: string, input: LinkEvidenceInput): LinkEvidenceResult {
  const now = input.now ?? new Date().toISOString();
  const evidence = findEvidenceById(root, input.evidence_id);
  if (!evidence) return { status: "failed", message: `Evidence not found: ${redactSecrets(input.evidence_id)}` };
  if (evidence.redaction_status === "deleted" || evidence.redaction_status === "redacted") {
    return { status: "failed", message: `Evidence ${evidence.id} is ${evidence.redaction_status}; cannot link as usable support.`, evidence_id: evidence.id };
  }

  const statement = redactSecrets(input.statement.trim());
  if (!statement) return { status: "failed", message: "Missing --statement for evidence link.", evidence_id: evidence.id };
  const worth = scoreMemoryWorth({
    observation: statement,
    explicitUserRequest: evidence.trust_class === "direct_user_instruction" || evidence.trust_class === "user_correction",
    evidenceStrength: evidence.source_kind === "codebase_analysis" ? 0.65 : 0.8,
    durability: trustDurability(evidence.durability_signal),
    operationalImpact: input.tags?.some((tag) => /testing|workflow|release|security|tooling/.test(tag)) ? 0.75 : undefined,
    scope: input.scope ?? evidence.scope_ref ?? evidence.profile_id,
  });

  if (/\b(maybe|somehow|risky|unclear|not sure)\b/i.test(statement) && /\b(always|never|workflow|release|security)\b/i.test(statement) && !input.forceReview) {
    const inquiry = upsertInquiryRecord(root, { question: statement, profile_id: evidence.profile_id, session_id: evidence.thread_id, now });
    return { status: "inquiry_created", message: `Created inquiry ${inquiry.id} instead of candidate.`, inquiry_id: inquiry.id, evidence_id: evidence.id, worth_decision: "inquiry", worth_reasons: [...worth.reasons, "ambiguous_high_impact_statement"] };
  }
  if (worth.decision === "reject" && !input.forceReview) {
    return { status: "rejected", message: `Memory-worth rejected this statement: ${worth.reasons.join(", ")}`, evidence_id: evidence.id, worth_decision: worth.decision, worth_reasons: worth.reasons };
  }
  if (worth.decision === "daily_only" && !input.forceReview) {
    appendDailyLog(root, todayString(new Date(now)), `Evidence-link daily-only note for ${evidence.id}: ${statement}`);
    return { status: "daily_only", message: `Routed to daily log instead of durable candidate: ${evidence.id}`, evidence_id: evidence.id, worth_decision: worth.decision, worth_reasons: worth.reasons };
  }
  if (worth.decision === "inquiry" && !input.forceReview) {
    const inquiry = upsertInquiryRecord(root, { question: statement, profile_id: evidence.profile_id, session_id: evidence.thread_id, now });
    return { status: "inquiry_created", message: `Created inquiry ${inquiry.id} instead of candidate.`, inquiry_id: inquiry.id, evidence_id: evidence.id, worth_decision: worth.decision, worth_reasons: worth.reasons };
  }

  const confidence = computeCandidateConfidence({ evidenceRecords: [evidence], primaryTrustClass: evidence.trust_class, userProvidedConfidence: input.confidence, durabilitySignals: [evidence.durability_signal ?? "unknown"] });
  const candidate: CaptureCandidate = attachVerification(root, {
    id: `cap_evidence_link_${safeId(evidence.id)}_${now.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    resource_id: evidence.resource_id,
    profile_id: evidence.profile_id,
    thread_id: evidence.thread_id,
    created_at: now,
    source: { type: "memory_evidence_link", ref: evidence.id, cwd: input.cwd },
    text: statement,
    tags: input.tags ?? evidence.tags ?? [],
    evidence_refs: [evidence.id],
    evidence_ids: [evidence.id],
    confidence: confidence.confidence,
    status: "new",
    memory_kind: input.kind ?? inferMemoryKind(statement),
    worth_decision: worth.decision === "reject" && input.forceReview ? "candidate" : worth.decision,
    worth_score: worth.worth_score,
    worth_reasons: [...worth.reasons, ...confidence.reasons, "review_required:evidence_link"],
    ...buildCandidateTrustMetadata(evidence.trust_class, evidence.durability_signal ?? "project"),
    promotion_eligibility: "review_only",
  });
  appendCandidate(root, candidate);
  const note = evidence.source_kind === "codebase_analysis" ? " Codebase-analysis evidence is deterministic support, not durable authority." : "";
  return { status: "candidate_created", message: `Created review-required candidate ${candidate.id} from evidence ${evidence.id}.${note}`, candidate, evidence_id: evidence.id, worth_decision: worth.decision, worth_reasons: worth.reasons };
}
