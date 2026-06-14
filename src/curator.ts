import { listCandidates } from "./inbox";
import { loadActiveRecords } from "./store";
import { inferProjectScope } from "./project";
import { runConfiguredLlmAssist, type LlmAssistConfig } from "./llmAssist";
import { suggestVaultRefs } from "./retriever";
import { isAutoApplyEligibleCandidate } from "./trust";
import { loadConfig } from "./config";
import { applyCandidateMatch } from "./matching";
import { attachVerification } from "./verifier";
import { createInquiryFromCandidate } from "./inquiries";
import type { CaptureCandidate, MemoryPatch, MemoryRecord, PatchOp } from "./types";

interface CurateOptions {
  now: string;
  mode: "propose" | "supervised" | "auto";
  minConfidence?: number;
  minEvidenceCount?: number;
  /** Optional path to the Obsidian vault for vault_ref auto-suggestion. */
  vaultPath?: string;
  /** Governance mode for auto-apply gating; loaded from config if omitted */
  governanceMode?: "compatibility" | "strict";
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function nextReviewDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function memoryIdFromCandidate(candidate: CaptureCandidate): string {
  return candidate.id.replace(/^cap_/, "mem_");
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

function heuristicSupersedes(candidate: CaptureCandidate, records: MemoryRecord[]): string | null {
  if (!hasContradictionCue(candidate.text)) return null;
  const tags = new Set(candidateTags(candidate));
  let best: { id: string; score: number } | null = null;
  for (const record of records) {
    const overlap = record.tags.filter((tag) => tags.has(tag)).length;
    if (overlap === 0) continue;
    const terms = candidate.text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const mentions = terms.filter((term) => term.length > 3 && record.statement.toLowerCase().includes(term)).length;
    const score = overlap * 2 + mentions;
    if (!best || score > best.score) best = { id: record.id, score };
  }
  return best && best.score >= 2 ? best.id : null;
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

function candidateToRecord(candidate: CaptureCandidate, now: string): MemoryRecord {
  const created = dateOnly(now);
  return {
    id: memoryIdFromCandidate(candidate),
    layer: "L2",
    scope: candidate.source.cwd ? inferProjectScope(candidate.source.cwd) : { type: "global" },
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
    // Propagate typed metadata from candidate (set by correction detection, memory-worth scoring, or manual capture)
    ruleType: candidate.ruleType,
    memory_kind: candidate.memory_kind,
  };
}

function eligibleCandidates(root: string, options: CurateOptions): CaptureCandidate[] {
  const minConfidence = options.minConfidence ?? 0.75;
  const minEvidenceCount = options.minEvidenceCount ?? 2;
  return listCandidates(root).filter((candidate) =>
    candidate.status === "new" &&
    (candidate.confidence ?? 0) >= minConfidence &&
    candidate.evidence_refs.length >= minEvidenceCount
  );
}

function buildPatch(root: string, options: CurateOptions, llmContradictions = new Map<string, LlmContradiction>()): MemoryPatch {
  const eligible = eligibleCandidates(root, options);
  const activeRecords = loadActiveRecords(root);
  const activeIds = new Set(activeRecords.map((record) => record.id));

  const ops: PatchOp[] = eligible.map((rawCandidate, index) => {
    const candidate = attachVerification(root, applyCandidateMatch(rawCandidate, activeRecords));
    // Automatically create open inquiry for ambiguous/conflict matches where human resolution is needed
    createInquiryFromCandidate(root, candidate, { profile_id: candidate.profile_id ?? options.vaultPath });
    const llm = llmContradictions.get(candidate.id);
    const explicitTarget = explicitSupersedes(candidate);
    const heuristicTarget = heuristicSupersedes(candidate, activeRecords);
    const targetId = explicitTarget ?? heuristicTarget ?? llm?.target_id ?? null;
    const record = { ...candidateToRecord(candidate, options.now), normalized_key: candidate.normalized_key };
    const base = {
      op_id: `op_${String(index + 1).padStart(3, "0")}`,
      candidate_id: candidate.id,
    };

    if (targetId && activeIds.has(targetId)) {
      const reason = explicitTarget
        ? `Candidate ${candidate.id} explicitly supersedes ${targetId}.`
        : heuristicTarget
          ? `Candidate ${candidate.id} appears to supersede ${targetId} based on contradiction cues and overlapping tags.`
          : llm?.reason ?? `LLM review suggested ${candidate.id} supersedes ${targetId}.`;
      return {
        ...base,
        op: "supersede" as const,
        target_id: targetId,
        to_record: { ...record, supersedes: [targetId] },
        reason,
        rationale: `Supersede ${targetId} with ${candidate.id}.`,
        risk: "medium" as const,
        default_selected: false,
      };
    }

    // Build vault_ref hint from configured vault path
    const vaultHint = (() => {
      const vaultPath = options.vaultPath ?? process.env.PI_VAULT_PATH;
      if (!vaultPath) return "";
      const suggestions = suggestVaultRefs(candidateTags(candidate), vaultPath);
      return suggestions.length > 0 ? ` Possible vault_ref: ${suggestions.map((s) => `[[${s}]]`).join(", ")}.` : "";
    })();

    const autoApplyEligible = isAutoApplyEligibleCandidate(candidate, options.governanceMode ?? "compatibility");
    const trustGateNote = autoApplyEligible ? "" : " Trust/match gate requires human review before auto-apply.";
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

  const stamp = options.now.replace(/[-:T]/g, "").slice(0, 12);
  return {
    patch_id: `patch_${stamp}_001`,
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
  const candidates = eligibleCandidates(root, options);
  const records = loadActiveRecords(root);
  if (!llm.enabled || !llm.command || candidates.length === 0 || records.length === 0) return buildPatch(root, options);
  const result = await runConfiguredLlmAssist(llm, { task: "curate", candidates, records });
  return buildPatch(root, options, parseLlmContradictions(result));
}
