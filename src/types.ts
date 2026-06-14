export type MemoryLayer = "L1" | "L2" | "L3";
export type MemoryStatus = "active" | "contested" | "deprecated" | "superseded" | "promoted" | "deleted";
export type Stability = "low" | "semi-stable" | "stable";
export type EvidenceType = "artifact" | "conversation" | "commit" | "source" | "manual" | "user_correction" | "test_result" | "codebase_analysis";
export type MemoryKind = "fact" | "event" | "instruction" | "task";

export type EvidenceTrustClass =
  | "direct_user_instruction"
  | "user_correction"
  | "repeated_user_preference"
  | "accepted_code_review_outcome"
  | "existing_project_convention"
  | "passing_tool_or_test_outcome"
  | "agent_inference"
  | "single_session_observation"
  | "repository_text"
  | "generated_content"
  | "third_party_documentation";

export type EvidencePolarity = "supports" | "contradicts" | "qualifies";

export type DurabilitySignal =
  | "temporary"
  | "session"
  | "task"
  | "project"
  | "repository"
  | "user_global"
  | "long_term"
  | "unknown";

export type PromotionEligibility = "never" | "review_only" | "auto_candidate" | "auto_apply_l2" | "l1_review_only";
export type DeletionMode = "audit_preserving" | "privacy_purge";
export type DeletionReason = "user_requested" | "privacy_sensitive" | "poisoned" | "invalid" | "other";
export type GovernanceMode = "compatibility" | "strict";

export type StrictGovernanceBlockReason =
  | "strict_governance_missing_trust_metadata"
  | "strict_governance_missing_verification"
  | "strict_governance_missing_evidence";

export type VerificationFailureReason =
  | "missing_evidence"
  | "source_not_supportive"
  | "scope_unsupported"
  | "temporary_durability"
  | "low_trust_source"
  | "high_poisoning_risk"
  | "match_requires_review"
  | "redacted_or_deleted_evidence"
  | "tombstoned_recreation";

export type VerificationStatus = "legacy_unverified" | "verified" | "review_required" | "rejected";

export interface VerificationResult {
  supported: boolean;
  verification_status: VerificationStatus;
  failure_reasons: VerificationFailureReason[];
  unsupported_claims: string[];
  scope_supported: boolean;
  durability_supported: boolean;
  trust_class?: EvidenceTrustClass;
  poisoning_risk: "low" | "medium" | "high";
  verification_notes: string[];
  requires_human_review: boolean;
}

export type ConsolidationTrigger = "correction_detected" | "context_compaction" | "session_end" | "manual" | "scheduled";

export type ReinforcementOutcome = "explicit_reinforcement" | "implicit_success" | "neutral_exposure" | "explicit_correction";

export type InquiryStatus = "open" | "answered" | "withdrawn" | "stale";
export type InquiryPriority = "low" | "medium" | "high";

export interface InquiryRecord {
  id: string;
  resource_id?: string;
  profile_id?: string;
  question: string;
  context: string;
  scope_level?: string;
  scope_ref?: string;
  tags: string[];
  related_memory_ids?: string[];
  related_evidence_ids?: string[];
  sessions_touched: string[];
  first_seen: string;
  last_seen: string;
  status: InquiryStatus;
  priority: InquiryPriority;
  answer_memory_id?: string;
}

export interface ReinforcementEvent {
  id: string;
  resource_id?: string;
  profile_id?: string;
  thread_id?: string;
  memory_id: string;
  timestamp: string;
  outcome: ReinforcementOutcome;
  evidence_id?: string;
  notes?: string;
}

export interface ReinforcementSummary {
  memory_id?: string;
  counts: Record<ReinforcementOutcome, number>;
  score: number;
  suggested_stability: Stability;
  review_recommended: boolean;
  reasons: string[];
}

export interface MetaConsolidationConfig {
  enabled: boolean;
  cadence: "manual" | "weekly" | "monthly";
  min_l2_records: number;
  min_reinforcement_score: number;
  max_candidates_per_run: number;
  max_input_records: number;
  require_counterexample_search: boolean;
}

export interface MetaConsolidationCluster {
  cluster_key: string;
  profile_id?: string;
  topic: string;
  ruleType?: MemoryRuleType;
  normalized_keys: string[];
  source_memory_ids: string[];
  stability_scores: number[];
  avg_confidence: number;
  reinforcement_score?: number;
  known_exceptions: string[];
  does_not_apply_when: string[];
}

export interface CounterexampleSearchResult {
  performed: true;
  sources_checked: string[];
  contradicting_memory_ids: string[];
  contested_record_ids: string[];
  known_exceptions: string[];
  open_inquiry_ids: string[];
  tombstone_ids: string[];
  unresolved_questions: string[];
}

export interface MetaConsolidationCandidate {
  id: string;
  proposed_layer: "L1";
  proposed_statement: string;
  profile_id?: string;
  source_l2_ids: string[];
  source_evidence_ids: string[];
  proposed_applies_when?: string[];
  proposed_does_not_apply_when?: string[];
  proposed_known_exceptions?: string[];
  counterexample_search: CounterexampleSearchResult;
  promotion_eligibility: "l1_review_only";
  rationale: string;
}

export interface MetaConsolidationRun {
  id: string;
  timestamp: string;
  profile_id?: string;
  config_snapshot: MetaConsolidationConfig;
  clusters: MetaConsolidationCluster[];
  candidates: MetaConsolidationCandidate[];
  skipped_reasons: Record<string, string>;
  report_path?: string;
}

export interface ExportableMemoryArtifact {
  id: string;
  created_at: string;
  artifact_type: "meta_consolidation" | "handoff_snapshot" | "maintenance_report";
  profile_id?: string;
  content_summary: string;
  source_run_id?: string;
  payload: Record<string, unknown>;
}

export interface MemoryHandoffSnapshot {
  id: string;
  created_at: string;
  profile_id?: string;
  resource_id?: string;
  active_l1_count: number;
  active_l2_count: number;
  selected_memory_brief: string[];
  open_inquiry_count: number;
  open_inquiry_questions: string[];
  contested_record_ids: string[];
  recent_evidence_count: number;
  pending_candidate_count: number;
  reinforcement_summary_brief: string;
}

export type MaintenanceRecommendationKind = "review_memory" | "decrease_stability" | "increase_stability" | "flag_for_review" | "mark_contested_suggestion" | "review_due";

export interface MaintenanceRecommendation {
  memory_id: string;
  kind: MaintenanceRecommendationKind;
  reason: string;
  requires_review: boolean;
  current_stability?: Stability;
  suggested_stability?: Stability;
  reinforcement_summary?: ReinforcementSummary;
}

export interface DeletionTombstone {
  id: string;
  resource_id?: string;
  profile_id?: string;
  deleted_record_id: string;
  deleted_at: string;
  deletion_mode: DeletionMode;
  deletion_reason: DeletionReason;
  content_hash?: string;
  content_removed: true;
}
export type NormalizedMemoryKey = string;
export type CandidateMatchKind =
  | "new"
  | "duplicate"
  | "strengthens_existing"
  | "updates_existing"
  | "potential_conflict"
  | "supersedes_existing"
  | "ambiguous";

export interface MemoryKeyParts {
  profile_id: string;
  scope_level: string;
  scope_ref: string;
  topic: string;
  ruleType?: MemoryRuleType;
}

export type EvidenceSourceKind =
  | "conversation"
  | "tool_result"
  | "file"
  | "patch"
  | "test_result"
  | "generated_content"
  | "external_document"
  | "codebase_analysis";

export type CodebaseAnalysisTool = "tsc" | "eslint" | "playwright" | "vitest" | "fallow" | "custom";
export type CodebaseAnalysisKind = "typecheck" | "lint" | "test" | "e2e" | "dependency" | "dead_code" | "complexity" | "security" | "duplication" | "custom";

export interface CodebaseAnalysisEvidenceMetadata {
  source_kind: "codebase_analysis";
  tool: CodebaseAnalysisTool;
  tool_version?: string;
  command?: string;
  exit_code?: number;
  file_path?: string;
  symbol?: string;
  analysis_kind?: CodebaseAnalysisKind;
  confidence?: number;
  timestamp: string;
}

export interface EvidenceRecord {
  id: string;
  resource_id: string;
  profile_id: string;
  thread_id?: string;
  created_at: string;
  source_kind: EvidenceSourceKind;
  source_session_id?: string;
  source_file?: string;
  source_tool?: string;
  source_ref?: string;
  source_summary: string;
  source_excerpt?: string;
  excerpt_hash?: string;
  excerpt_char_start?: number;
  excerpt_char_end?: number;
  redaction_status?: "none" | "redacted" | "deleted";
  trust_class: EvidenceTrustClass;
  polarity: EvidencePolarity;
  durability_signal?: DurabilitySignal;
  related_memory_ids: string[];
  scope_level?: string;
  scope_ref?: string;
  tags?: string[];
  notes?: string;
  /** Deterministic codebase-analysis evidence supports review; it never bypasses governance. */
  codebase_analysis?: CodebaseAnalysisEvidenceMetadata;
}

export type ProfileType = "user" | "repo" | "project" | "workspace" | "team";
export type ProjectIdentitySource = "explicit_config" | "git_remote" | "git_root" | "package_name" | "cwd_fallback";

export interface MemoryAddress {
  resource_id: string;
  profile_id: string;
  thread_id?: string;
}

export interface ProjectIdentity {
  project_id: string;
  source: ProjectIdentitySource;
  git_remote_hash?: string;
  git_root?: string;
  package_name?: string;
  workspace_name?: string;
  aliases?: string[];
}

export interface MemoryProfile {
  profile_id: string;
  profile_type: ProfileType;
  resource_id: string;
  project_identity?: ProjectIdentity;
  storage_root: string;
  created_at: string;
  updated_at: string;
}

export type DomainTag =
  | "frontend"
  | "backend"
  | "database"
  | "testing"
  | "devops"
  | "tooling"
  | "documentation"
  | "release"
  | "security"
  | "design"
  | "architecture"
  | "memory_governance";

export interface SessionContext extends MemoryAddress {
  project_root?: string;
  repository_id?: string;
  working_directory?: string;
  first_user_message?: string;
  latest_user_message?: string;
  recent_files_touched?: string[];
  detected_domain_tags: DomainTag[];
  task_intent?: string;
  is_trivial_prompt: boolean;
}

export interface ProcessorTrace {
  processor: string;
  input_count: number;
  output_count: number;
  excluded_ids: string[];
  exclusion_reasons: Record<string, string>;
}

/**
 * Typed rule categories — adapted from pi-code-intelligence's LearningRuleType.
 * Enables better filtering, retrieval priority, and hard-rule injection.
 */
export type MemoryRuleType =
  | "workflow"        // process / how-to-work patterns
  | "preference"      // tool, language, or style preferences
  | "convention"      // project-specific conventions ("this project uses X")
  | "architecture"    // architectural decisions
  | "avoid_pattern"   // explicit "don't use X" corrections
  | "prefer_pattern"  // explicit "prefer Y over X" corrections
  | "testing"         // testing conventions
  | "correction"      // user-stated corrections (catch-all)
  | "tool";           // tool-specific patterns

export interface EvidenceRef {
  type: EvidenceType | string;
  ref: string;
  note: string;
}

export interface MemoryScope {
  type: "global" | "project" | "domain";
  project?: string;
  domains?: string[];
}

export interface MemoryReview {
  cadence_days: number;
  next_review: string;
  change_condition: string;
}

export interface MemoryRecord {
  id: string;
  /** Optional in v0.7.x records; absent records are treated as legacy/default-profile compatible. */
  resource_id?: string;
  /** Optional in v0.7.x records; absent records are treated as legacy/default-profile compatible. */
  profile_id?: string;
  /** Optional session/thread provenance for future L3/evidence linkage. */
  thread_id?: string;
  normalized_key?: NormalizedMemoryKey;
  applies_when?: string[];
  does_not_apply_when?: string[];
  known_exceptions?: string[];
  layer: MemoryLayer;
  scope: MemoryScope;
  tags: string[];
  statement: string;
  evidence: EvidenceRef[];
  confidence: number;
  stability: Stability;
  created_at: string;
  updated_at: string;
  review: MemoryReview;
  status: MemoryStatus;
  valid_from?: string;
  valid_to?: string;
  invalidated_by?: string;
  validity_reason?: string;
  supersedes: string[];
  superseded_by: string[];
  vault_ref: string | null;
  /** Optional typed rule category — set by correction detection and manual capture */
  ruleType?: MemoryRuleType;
  /** Optional public taxonomy for filtering/explanation. Missing legacy values are inferred at read/report time. */
  memory_kind?: MemoryKind;
}

export interface CaptureCandidate {
  id: string;
  resource_id?: string;
  profile_id?: string;
  thread_id?: string;
  created_at: string;
  source: { type: string; ref: string; cwd?: string };
  text: string;
  tags: string[];
  evidence_refs: string[];
  /** Optional structured evidence IDs; legacy candidates may only have evidence_refs. */
  evidence_ids?: string[];
  confidence?: number;
  status: "new" | "patched" | "rejected";
  /** Optional rule type hint from correction detection */
  ruleType?: MemoryRuleType;
  /** Optional public taxonomy for filtering/explanation. */
  memory_kind?: MemoryKind;
  /** Optional memory-worth decision diagnostics captured before durable candidate creation. */
  worth_decision?: MemoryWorthDecision;
  worth_score?: number;
  worth_reasons?: string[];
  primary_trust_class?: EvidenceTrustClass;
  source_trust_weight?: number;
  durability_signal?: DurabilitySignal;
  promotion_eligibility?: PromotionEligibility;
  poisoning_risk?: "low" | "medium" | "high";
  poisoning_risk_reasons?: string[];
  normalized_key?: NormalizedMemoryKey;
  match_kind?: CandidateMatchKind;
  matched_memory_ids?: string[];
  match_reasons?: string[];
  proposed_applies_when?: string[];
  proposed_does_not_apply_when?: string[];
  proposed_known_exceptions?: string[];
  verification_status?: VerificationStatus;
  verification_result?: VerificationResult;
}

export type MemoryWorthDecision = "reject" | "daily_only" | "candidate" | "inquiry";

export type PatchOpType = "add" | "update" | "update_stability" | "flag_for_review" | "supersede" | "deprecate" | "decay" | "contest" | "uncontest" | "add_exception" | "delete" | "reject_candidate" | "promote_to_vault_candidate";

export interface PatchOp {
  op_id: string;
  op: PatchOpType;
  target?: string;
  target_id?: string;
  from?: string;
  record?: MemoryRecord;
  to_record?: MemoryRecord;
  updates?: Partial<MemoryRecord>;
  reason?: string;
  rationale?: string;
  risk: "low" | "medium" | "high";
  default_selected: boolean;
  candidate_id?: string;
  deletion_mode?: DeletionMode;
  deletion_reason?: DeletionReason;
}

export interface MemoryPatch {
  patch_id: string;
  created_at: string;
  generated_by: "curator" | "maintainer" | "manual";
  mode: "propose" | "supervised" | "auto";
  summary: string;
  ops: PatchOp[];
  status: "proposed" | "applied" | "partially_applied";
  applied_at: string | null;
  applied_ops: string[];
  skipped_ops: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!isObject(value)) return false;
  if (typeof value.id !== "string" || !value.id) return false;
  if (value.layer !== "L1" && value.layer !== "L2" && value.layer !== "L3") return false;
  if (!isObject(value.scope) || typeof value.scope.type !== "string") return false;
  if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string")) return false;
  if (typeof value.statement !== "string" || value.statement.trim().length === 0) return false;
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) return false;
  for (const evidence of value.evidence) {
    if (!isObject(evidence) || typeof evidence.ref !== "string" || typeof evidence.note !== "string") return false;
  }
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) return false;
  if (value.stability !== "low" && value.stability !== "semi-stable" && value.stability !== "stable") return false;
  if (typeof value.created_at !== "string" || typeof value.updated_at !== "string") return false;
  if (!isObject(value.review)) return false;
  if (typeof value.review.cadence_days !== "number") return false;
  if (typeof value.review.next_review !== "string") return false;
  if (typeof value.review.change_condition !== "string" || value.review.change_condition.trim().length === 0) return false;
  if (!Array.isArray(value.supersedes) || !Array.isArray(value.superseded_by)) return false;
  if (typeof value.status !== "string") return false;
  if (value.vault_ref !== null && typeof value.vault_ref !== "string") return false;
  // ruleType is optional — no validation required for backward compat
  return true;
}
