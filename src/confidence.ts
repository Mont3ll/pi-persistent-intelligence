import type { DurabilitySignal, EvidenceRecord, EvidenceTrustClass, GovernanceMode, ReinforcementSummary } from "./types";

export interface CandidateConfidenceInput {
  evidenceRecords?: EvidenceRecord[];
  primaryTrustClass?: EvidenceTrustClass;
  corroborationCount?: number;
  durabilitySignals?: DurabilitySignal[];
  recency?: "fresh" | "recent" | "stale" | "unknown";
  contradictionSignals?: string[];
  reinforcementSummary?: ReinforcementSummary;
  userProvidedConfidence?: number;
  governanceMode?: GovernanceMode;
}

export interface CandidateConfidenceResult {
  confidence: number;
  user_provided_confidence?: number;
  ceiling: number;
  floor: number;
  review_required: boolean;
  reasons: string[];
}

const TRUST_BASE: Record<EvidenceTrustClass, number> = {
  direct_user_instruction: 0.9,
  user_correction: 0.9,
  repeated_user_preference: 0.86,
  accepted_code_review_outcome: 0.82,
  existing_project_convention: 0.82,
  passing_tool_or_test_outcome: 0.72,
  agent_inference: 0.55,
  single_session_observation: 0.58,
  repository_text: 0.55,
  generated_content: 0.45,
  third_party_documentation: 0.62,
};

const LOW_TRUST = new Set<EvidenceTrustClass>(["agent_inference", "single_session_observation", "repository_text", "generated_content", "third_party_documentation"]);

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }

export function computeCandidateConfidence(input: CandidateConfidenceInput): CandidateConfidenceResult {
  const evidence = input.evidenceRecords ?? [];
  const trust = input.primaryTrustClass ?? evidence[0]?.trust_class;
  const reasons: string[] = [];
  let floor = 0.1;
  let ceiling = 0.95;
  let base = trust ? TRUST_BASE[trust] : 0.5;

  if (!trust) { ceiling = Math.min(ceiling, input.governanceMode === "strict" ? 0.49 : 0.7); reasons.push("missing_trust_metadata"); }
  else reasons.push(`trust_class:${trust}`);

  if (trust && LOW_TRUST.has(trust)) { ceiling = Math.min(ceiling, 0.64); reasons.push("low_trust_confidence_ceiling"); }
  if (evidence.some((item) => item.source_kind === "codebase_analysis")) { ceiling = Math.min(ceiling, 0.78); reasons.push("codebase_analysis_support_not_authority"); }
  if (evidence.length === 0) { ceiling = Math.min(ceiling, input.governanceMode === "strict" ? 0.49 : 0.72); reasons.push("no_structured_evidence"); }
  if (evidence.some((item) => item.redaction_status === "redacted" || item.redaction_status === "deleted")) { ceiling = Math.min(ceiling, 0.35); reasons.push("redacted_or_deleted_evidence"); }
  if ((input.contradictionSignals ?? []).length > 0) { ceiling = Math.min(ceiling, 0.55); base -= 0.18; reasons.push("contradiction_signal"); }
  if ((input.corroborationCount ?? 0) > 1) { base += Math.min(0.08, (input.corroborationCount ?? 0) * 0.02); reasons.push("corroborated"); }
  if (input.reinforcementSummary && input.reinforcementSummary.score > 0) { base += Math.min(0.06, input.reinforcementSummary.score * 0.03); reasons.push("reinforced"); }
  if (input.recency === "stale") { base -= 0.08; reasons.push("stale"); }
  if ((input.durabilitySignals ?? []).some((signal) => signal === "temporary" || signal === "session" || signal === "task")) { ceiling = Math.min(ceiling, 0.68); reasons.push("non_durable_signal"); }

  if (typeof input.userProvidedConfidence === "number") {
    base = (base + clamp01(input.userProvidedConfidence)) / 2;
    reasons.push("user_or_llm_confidence_is_input_not_authority");
  }

  const confidence = Number(clamp01(Math.max(floor, Math.min(base, ceiling))).toFixed(3));
  const review_required = confidence < 0.85 || ceiling < 0.85 || input.governanceMode === "strict" && (!trust || evidence.length === 0);
  return { confidence, user_provided_confidence: input.userProvidedConfidence, ceiling, floor, review_required, reasons };
}
