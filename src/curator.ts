import { createHash } from "node:crypto";
import { listCandidates } from "./inbox";
import { loadActiveRecords } from "./store";
import { inferProjectScope } from "./project";
import { runConfiguredLlmAssist, type LlmAssistConfig } from "./llmAssist";
import { suggestVaultRefs } from "./retriever";
import { isAutoApplyEligibleCandidate } from "./trust";
import { classifyCaptureIntent } from "./capture-intent";
import { loadConfig } from "./config";
import { decideTrustedAutoEvidenceEligibility, type AutoEvidenceDecision } from "./auto-evidence-policy";
import { createTranscriptDiscoveryIndex, type TranscriptProofOptions } from "./transcript-proof";
import { applyCandidateMatch } from "./matching";
import { attachVerification } from "./verifier";
import { createInquiryFromCandidate } from "./inquiries";
import { readEvidenceRecords } from "./evidence";
import { resolveEvidenceReference } from "./evidence-resolution";
import { getDerivedRecordMemoryKeyV2, isStructuralMemoryKey } from "./memory-key";
import type { CaptureCandidate, CaptureScopeTarget, EvidenceRecord, MemoryPatch, MemoryRecord, MemoryScope, PatchOp } from "./types";

const STRUCTURED_EVIDENCE_REQUIRED_SOURCE_TYPES = new Set(["conversation", "direct_user_instruction", "user_preference", "user_correction", "historical_session_audit", "session_capture"]);

interface CurateOptions {
  now: string;
  mode: "propose" | "supervised" | "auto";
  minConfidence?: number;
  minEvidenceCount?: number;
  /** Optional path to the Obsidian vault for vault_ref auto-suggestion. */
  vaultPath?: string;
  /** Governance mode for auto-apply gating; loaded from config if omitted */
  governanceMode?: "compatibility" | "strict";
  /** Trusted Pi session roots supplied by host/test harness, never candidates. */
  trustedTranscriptOptions?: TranscriptProofOptions;
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function nextReviewDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function scopeHash(target: CaptureScopeTarget): string {
  return createHash("sha256").update(JSON.stringify({ type: target.type, project: target.project, domain: target.domain })).digest("hex").slice(0, 8);
}

function memoryIdFromCandidate(candidate: CaptureCandidate, target?: CaptureScopeTarget): string {
  const base = candidate.id.replace(/^cap_/, "mem_");
  return target && (candidate.scope_targets?.length ?? 0) > 1 ? `${base}_${scopeHash(target)}` : base;
}

function memoryScopeFromTarget(target: CaptureScopeTarget): MemoryScope {
  if (target.type === "project") return { type: "project", project: target.project };
  if (target.type === "domain") return { type: "domain", domains: target.domain ? [target.domain] : [] };
  return { type: "global" };
}

function explicitSupersedes(candidate: CaptureCandidate): string | null {
  const tag = candidate.tags.find((item) => item.startsWith("supersedes:"));
  if (tag) return tag.slice("supersedes:".length);
  const match = candidate.text.match(/\bsupersedes\s+([a-zA-Z0-9_-]+)/i);
  return match?.[1] ?? null;
}

function candidateTags(candidate: CaptureCandidate): string[] {
  return candidate.tags.filter((tag) => !tag.startsWith("supersedes:"));
}

function hasContradictionCue(text: string): boolean {
  return /\b(no longer|instead of|rather than|replace|replaces|deprecated|do not|don't|avoid|stop)\b/i.test(text);
}

const STRUCTURAL_CAPTURE_TAGS = new Set([
  "capture",
  "user_preference",
  "behavior_correction",
  "project_convention",
  "workflow_playbook",
  "temporary_instruction",
  "not_memory",
  "documentation",
  "implementation",
  "release",
  "testing",
  "verification",
  "verifier",
  "workflow",
  "writing",
]);

const SUPERSESSION_STOP_WORDS = new Set([
  "avoid", "deprecated", "directly", "does", "dont", "include", "instead", "longer",
  "never", "project", "rather", "replace", "replaces", "should", "stop", "than", "these",
  "this", "from", "current", "state", "continue",
]);

const GENERIC_OPERATION_IDENTITY_TERMS = new Set([
  "action", "actions", "artifact", "artifacts", "branch", "code", "commit", "commits",
  "github", "implementation", "local", "merge", "modify", "package", "previous", "publish",
  "release", "remote", "report", "reports", "repository", "rerun", "result", "results", "source",
  "stage", "task", "test", "tests", "verification", "verifier", "verify", "workflow", "work",
]);

function meaningfulTerms(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/)
    .filter((term) => term.length > 3 && !SUPERSESSION_STOP_WORDS.has(term)));
}

function scopeCompatibleForHeuristic(candidate: CaptureCandidate, record: MemoryRecord): boolean {
  if (candidate.profile_id && record.profile_id && candidate.profile_id !== record.profile_id) return false;
  const targets = candidate.scope_targets?.filter((target) => target.type !== "session") ?? [];
  if (targets.length === 0) {
    const fallbackScope: MemoryScope = candidate.source.cwd ? inferProjectScope(candidate.source.cwd) : { type: "global" };
    if (fallbackScope.type === "global") return record.scope.type === "global";
    if (fallbackScope.type === "project") return record.scope.type === "project" && record.scope.project === fallbackScope.project;
    return record.scope.type === "domain" && (fallbackScope.domains ?? []).some((domain) => record.scope.domains?.includes(domain));
  }
  return targets.some((target) => {
    if (target.type === "global") return record.scope.type === "global";
    if (target.type === "project") return record.scope.type === "project" && record.scope.project === target.project;
    if (target.type === "domain") return record.scope.type === "domain" && Boolean(target.domain && record.scope.domains?.includes(target.domain));
    return false;
  });
}

function heuristicSupersedes(candidate: CaptureCandidate, records: MemoryRecord[]): string | null {
  if (!hasContradictionCue(candidate.text)) return null;
  const strongCueMatch = candidate.text.match(/\b(no longer|instead of|rather than|replace|replaces|deprecated)\b/i);
  const strongCue = strongCueMatch?.index !== undefined && strongCueMatch.index <= 120;
  const weakCueMatch = candidate.text.match(/\b(?:do not|don't|avoid|stop)\b([^.;\n]{1,200})/i);
  const weakCueTerms = meaningfulTerms(weakCueMatch?.[1] ?? "");
  const tags = new Set(candidateTags(candidate).filter((tag) => !STRUCTURAL_CAPTURE_TAGS.has(tag)));
  const candidateTerms = meaningfulTerms(candidate.text);
  const matchedIds = new Set(candidate.matched_memory_ids ?? []);
  let best: { id: string; score: number } | null = null;
  for (const record of records) {
    if (!scopeCompatibleForHeuristic(candidate, record)) continue;
    if (!strongCue && hasContradictionCue(record.statement)) continue;
    const substantiveOverlap = record.tags.filter((tag) => !STRUCTURAL_CAPTURE_TAGS.has(tag) && tags.has(tag)).length;
    const recordTerms = meaningfulTerms(record.statement);
    const overlappingTerms = [...candidateTerms].filter((term) => recordTerms.has(term));
    const lexicalMatches = overlappingTerms.length;
    const distinctiveMatches = overlappingTerms.filter((term) => !GENERIC_OPERATION_IDENTITY_TERMS.has(term)).length;
    const weakCueMatches = [...weakCueTerms].filter((term) => recordTerms.has(term)).length;
    const matchedIdentity = matchedIds.has(record.id);
    const identityEstablished = matchedIdentity || substantiveOverlap > 0 || (lexicalMatches >= 2 && distinctiveMatches >= 1);
    if (!identityEstablished) continue;
    if (!strongCue && !matchedIdentity) continue;
    if (!strongCue && weakCueMatches < 2) continue;
    const score = (matchedIdentity ? 4 : 0) + substantiveOverlap * 2 + lexicalMatches + distinctiveMatches;
    if (!best || score > best.score) best = { id: record.id, score };
  }
  return best?.id ?? null;
}

interface LlmContradiction {
  candidate_id: string;
  target_id: string;
  confidence?: number;
  reason?: string;
}

function isLlmContradiction(value: unknown): value is LlmContradiction {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.candidate_id === "string" && typeof item.target_id === "string";
}

function parseLlmContradictions(value: unknown): Map<string, LlmContradiction> {
  if (typeof value !== "object" || value === null) return new Map();
  const contradictions = (value as { contradictions?: unknown }).contradictions;
  if (!Array.isArray(contradictions)) return new Map();
  return new Map(contradictions.filter(isLlmContradiction).map((item) => [item.candidate_id, item]));
}

function candidateToRecord(candidate: CaptureCandidate, now: string, target?: CaptureScopeTarget): MemoryRecord {
  const created = dateOnly(now);
  return {
    id: memoryIdFromCandidate(candidate, target),
    resource_id: candidate.resource_id,
    profile_id: candidate.profile_id,
    thread_id: candidate.thread_id,
    layer: "L2",
    scope: target ? memoryScopeFromTarget(target) : candidate.source.cwd ? inferProjectScope(candidate.source.cwd) : { type: "global" },
    tags: candidateTags(candidate),
    statement: candidate.text,
    evidence: candidate.evidence_refs.map((ref) => ({ type: "artifact", ref, note: "Captured evidence reference" })),
    confidence: candidate.confidence ?? 0.75,
    stability: "semi-stable",
    created_at: created,
    updated_at: created,
    review: {
      cadence_days: 30,
      next_review: nextReviewDate(created, 30),
      change_condition: "If future sessions contradict this pattern or it fails in 2+ projects, revise or deprecate.",
    },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: candidate.ruleType,
    memory_kind: candidate.memory_kind,
    applies_when: candidate.proposed_applies_when,
    does_not_apply_when: candidate.proposed_does_not_apply_when,
    known_exceptions: candidate.proposed_known_exceptions,
    capture_group_id: candidate.capture_group_id,
  };
}

/**
 * One bounded session-header discovery per curation attempt. There is no
 * process-wide or persisted cache: a later attempt sees newly flushed
 * transcripts, while apply runs a fresh proof in its transaction.
 */
function withCurationDiscovery(root: string, options: CurateOptions): CurateOptions {
  if (options.trustedTranscriptOptions?.discoveryIndex) return options;
  const config = loadConfig(root).curator;
  if (config.sourceAwareAuto !== "transcript-verified-direct-user") return options;
  // Avoid scanning the session archive when no under-floor NEW candidate exists.
  const hasUnderfloor = listCandidates(root).some((candidate) =>
    candidate.status === "new" && candidate.evidence_refs.length < config.minEvidenceCount);
  if (!hasUnderfloor) return options;
  return {
    ...options,
    trustedTranscriptOptions: {
      ...options.trustedTranscriptOptions,
      discoveryIndex: createTranscriptDiscoveryIndex(options.trustedTranscriptOptions),
    },
  };
}

function eligibleCandidates(
  root: string,
  options: CurateOptions,
  sourceProofs?: Map<CaptureCandidate, AutoEvidenceDecision>,
): CaptureCandidate[] {
  const config = loadConfig(root).curator;
  const minConfidence = options.minConfidence ?? config.minConfidence;
  const minEvidenceCount = options.minEvidenceCount ?? config.minEvidenceCount;
  const evidence = readEvidenceRecords(root);
  return listCandidates(root).filter((candidate) => {
    if (candidate.status !== "new" || (candidate.confidence ?? 0) < minConfidence) return false;
    if (candidate.evidence_refs.length >= minEvidenceCount) return true;
    const decision = decideTrustedAutoEvidenceEligibility(
      candidate, evidence, config, options.trustedTranscriptOptions);
    if (decision.basis !== "transcript_verified_direct_user") return false;
    // Reuse solely within this synchronous proposal construction. No proof
    // result is persisted or carried over to apply/replay or the async LLM pass.
    sourceProofs?.set(candidate, decision);
    return true;
  });
}

function currentPolicyAllowsAutoApply(candidate: CaptureCandidate): boolean {
  // Legacy/manual candidates without capture-intent provenance retain the
  // existing compatibility contract.
  if (!candidate.capture_intent) return true;

  // Capture-pipeline worth decisions are authoritative for auto-apply.
  if (candidate.worth_decision && candidate.worth_decision !== "candidate") return false;

  const current = classifyCaptureIntent(candidate.text);
  if (current.intent === "temporary_instruction" || current.intent === "not_memory") return false;
  return current.durability !== "temporary" && current.durability !== "task";
}

function buildPatch(root: string, options: CurateOptions, llmContradictions = new Map<string, LlmContradiction>()): MemoryPatch {
  options = withCurationDiscovery(root, options);
  const sourceProofs = new Map<CaptureCandidate, AutoEvidenceDecision>();
  const eligible = eligibleCandidates(root, options, sourceProofs);
  const curatorConfig = loadConfig(root).curator;
  const configuredEvidenceFloor = curatorConfig.minEvidenceCount;
  const activeRecords = loadActiveRecords(root);
  const activeIds = new Set(activeRecords.map((record) => record.id));
  const existingEvidence = readEvidenceRecords(root);

  let opIndex = 0;
  const ops: PatchOp[] = eligible.flatMap((rawCandidate) => {
    const candidate = attachVerification(root, applyCandidateMatch(rawCandidate, activeRecords));
    createInquiryFromCandidate(root, candidate, { profile_id: candidate.profile_id ?? options.vaultPath });
    const llm = llmContradictions.get(candidate.id);
    const explicitTarget = explicitSupersedes(candidate);
    const heuristicTarget = heuristicSupersedes(candidate, activeRecords);
    const targetId = explicitTarget ?? heuristicTarget ?? llm?.target_id ?? null;
    const scopeTargets = candidate.scope_targets?.filter((target) => target.type !== "session") ?? [];
    const requestedTargets = scopeTargets.length > 0 ? scopeTargets : [undefined];
    const materializationTargets = requestedTargets.filter((scopeTarget) => !activeIds.has(candidateToRecord(candidate, options.now, scopeTarget).id));

    return materializationTargets.map((scopeTarget) => {
      opIndex++;
      const baseRecord = candidateToRecord(candidate, options.now, scopeTarget);
      const normalizedKey = candidate.normalized_key && !isStructuralMemoryKey(candidate.normalized_key)
        ? candidate.normalized_key
        : getDerivedRecordMemoryKeyV2(baseRecord);
      const resolutions = candidate.evidence_refs.map((reference) => resolveEvidenceReference({
        root,
        reference,
        existingEvidence,
        memoryId: baseRecord.id,
        resourceId: candidate.resource_id ?? "curation",
        profileId: candidate.profile_id ?? "legacy-default",
        createdAt: candidate.created_at,
        scopeLevel: baseRecord.scope.type,
        scopeRef: baseRecord.scope.type === "project" ? baseRecord.scope.project : baseRecord.scope.type === "domain" ? baseRecord.scope.domains?.join(",") : undefined,
        candidateTrustClass: candidate.primary_trust_class,
        candidateDurability: candidate.durability_signal,
        provenance: "curation_evidence_v1",
      }));
      const supportingEvidenceById = new Map<string, EvidenceRecord>();
      for (const resolution of resolutions) {
        if (resolution.status === "resolved") supportingEvidenceById.set(resolution.evidence.id, resolution.evidence);
        if (resolution.status === "alreadyStructured") {
          const evidence = existingEvidence.find((item) => item.id === resolution.evidenceId);
          if (evidence) supportingEvidenceById.set(evidence.id, { ...evidence, related_memory_ids: [...new Set([...evidence.related_memory_ids, baseRecord.id])] });
        }
      }
      const supportingEvidence = [...supportingEvidenceById.values()];
      const structuredIds = [...new Set(resolutions.flatMap((resolution) => resolution.status === "alreadyStructured" ? [resolution.evidenceId] : resolution.status === "resolved" ? [resolution.evidence.id] : []))];
      const record = {
        ...baseRecord,
        normalized_key: normalizedKey,
        evidence: [
          ...baseRecord.evidence,
          ...structuredIds.filter((id) => !baseRecord.evidence.some((item) => item.ref === id)).map((ref) => ({ type: "source" as const, ref, note: "Structured evidence resolved during curation." })),
        ],
      };
      const base = {
        op_id: `op_${String(opIndex).padStart(3, "0")}`,
        candidate_id: candidate.id,
        supportingEvidence,
        requiresStructuredEvidence: STRUCTURED_EVIDENCE_REQUIRED_SOURCE_TYPES.has(candidate.source.type),
      };

      if (targetId && activeIds.has(targetId) && requestedTargets.length === 1) {
        const reason = explicitTarget
          ? `Candidate ${candidate.id} explicitly supersedes ${targetId}.`
          : heuristicTarget
            ? `Candidate ${candidate.id} appears to supersede ${targetId} based on contradiction cues and substantive identity overlap.`
            : llm?.reason ?? `LLM review suggested ${candidate.id} supersedes ${targetId}.`;
        return {
          ...base,
          op: "supersede" as const,
          target_id: targetId,
          to_record: { ...record, supersedes: [targetId] },
          reason,
          rationale: `Supersede ${targetId} with ${candidate.id}.`,
          risk: "high" as const,
          default_selected: false,
        };
      }

      const vaultHint = (() => {
        const vaultPath = options.vaultPath ?? process.env.PI_VAULT_PATH;
        if (!vaultPath) return "";
        const suggestions = suggestVaultRefs(candidateTags(candidate), vaultPath);
        return suggestions.length > 0 ? ` Possible vault_ref: ${suggestions.map((s) => `[[${s}]]`).join(", ")}.` : "";
      })();

      const isGlobalPreference = scopeTarget?.type === "global" && candidate.capture_intent === "user_preference";
      // A human may explicitly review a verified single-source candidate,
      // but that exception must not silently lower configured auto-apply floors.
      const evidenceDecision = sourceProofs.get(rawCandidate)
        ?? decideTrustedAutoEvidenceEligibility(candidate, existingEvidence, curatorConfig, options.trustedTranscriptOptions);
      const evidenceCountMeetsConfiguredFloor = evidenceDecision.eligible;
      const autoApplyEligible = evidenceCountMeetsConfiguredFloor
        && candidate.capture_source?.version !== 2 // semantic model output is review-only until separate authority gate
        && !isGlobalPreference
        && currentPolicyAllowsAutoApply(candidate)
        && isAutoApplyEligibleCandidate(candidate, options.governanceMode ?? "compatibility");
      const holdCodes: string[] = [];
      if (!evidenceCountMeetsConfiguredFloor) holdCodes.push("below_configured_evidence_floor");
      if (isGlobalPreference) holdCodes.push("global_preference_review");
      if (!currentPolicyAllowsAutoApply(candidate)) holdCodes.push("current_capture_policy");
      if (candidate.verification_status === "review_required") holdCodes.push("verification_review_required");
      if (candidate.verification_status === "rejected") holdCodes.push("verification_rejected");
      if (candidate.promotion_eligibility === "review_only" || candidate.promotion_eligibility === "l1_review_only") holdCodes.push("promotion_review_only");
      if (candidate.poisoning_risk === "high") holdCodes.push("high_poisoning_risk");
      if (candidate.match_kind === "potential_conflict" || candidate.match_kind === "supersedes_existing" || candidate.match_kind === "ambiguous") holdCodes.push("match_requires_review");
      if (!isAutoApplyEligibleCandidate(candidate, options.governanceMode ?? "compatibility") && holdCodes.length === 0) holdCodes.push("trust_or_provenance_gate");
      const evidenceBasisNote = evidenceDecision.basis === "transcript_verified_direct_user"
        ? " Single transcript-verified authoritative user source accepted by explicitly configured source-aware policy."
        : "";
      const trustGateNote = (autoApplyEligible ? "" :
        ` Auto-apply held [${[...new Set(holdCodes)].join(", ")}].`
          + (!evidenceCountMeetsConfiguredFloor
            ? ` Below configured auto-apply evidence floor (${candidate.evidence_refs.length}/${configuredEvidenceFloor}); requires explicit human selection and governed evidence verification.`
            : " Requires explicit human review before apply.")) + evidenceBasisNote;
      const matchNote = candidate.match_kind && candidate.match_kind !== "new"
        ? ` Match: ${candidate.match_kind}; matched memories: ${(candidate.matched_memory_ids ?? []).join(", ") || "none"}; reasons: ${(candidate.match_reasons ?? []).join("; ") || "none"}. Suggested path: ${candidate.match_kind === "potential_conflict" ? "contest or add_exception" : candidate.match_kind === "supersedes_existing" ? "supersede after review" : candidate.match_kind === "ambiguous" ? "manual merge/review" : "review/update"}.`
        : "";

      return {
        ...base,
        op: "add" as const,
        target: "memory/L2.playbooks.jsonl",
        record,
        rationale: `Candidate ${candidate.id} meets L2 threshold (${candidate.evidence_refs.length} evidence refs, confidence ${candidate.confidence ?? 0}).${vaultHint}${matchNote}${trustGateNote}`,
        risk: candidate.poisoning_risk === "high" ? "high" as const : "low" as const,
        default_selected: autoApplyEligible,
      };
    });
  });

  const stamp = options.now.replace(/[-:T]/g, "").slice(0, 12);
  // A minute-stamped constant suffix causes distinct same-minute proposals
  // to reuse one governance transaction/receipt. Bind curator patch identity
  // to the materialized operation content and mode, preserving deterministic
  // replay for an identical proposal while separating changed candidate sets.
  const proposalDigest = createHash("sha256")
    .update(JSON.stringify({ mode: options.mode, ops }))
    .digest("hex").slice(0, 16);
  return {
    patch_id: `patch_${stamp}_${proposalDigest}`,
    created_at: options.now,
    generated_by: "curator",
    mode: options.mode,
    summary: ops.length ? `Promote ${ops.length} captured candidate(s) to L2.` : "No candidates met curation thresholds.",
    ops,
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}

export function curateInbox(root: string, options: CurateOptions): MemoryPatch {
  return buildPatch(root, options);
}

export async function curateInboxWithLlmReview(root: string, options: CurateOptions, llm: LlmAssistConfig): Promise<MemoryPatch> {
  options = withCurationDiscovery(root, options);
  const candidates = eligibleCandidates(root, options);
  const records = loadActiveRecords(root);
  if (!llm.enabled || !llm.command || candidates.length === 0 || records.length === 0) return buildPatch(root, options);
  const result = await runConfiguredLlmAssist(llm, { task: "curate", candidates, records });
  return buildPatch(root, options, parseLlmContradictions(result));
}
