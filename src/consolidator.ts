/**
 * Consolidator — extracts L2 memory candidates from session conversation.
 *
 * Includes Jaccard deduplication: candidates with >0.7 token overlap against
 * existing inbox items or active L2 records are silently skipped.
 */
import { createHash } from "node:crypto";
import { appendEvidenceRecordIfMissing, boundSourceExcerpt, boundSourceSummary, createEvidenceId } from "./evidence";
import { appendCandidate, listCandidates, withMemoryWorth } from "./inbox";
import { scoreMemoryWorth } from "./memory-worth";
import { resolveMemoryProfile } from "./profile";
import { inferProjectScope } from "./project";
import { loadActiveRecords } from "./store";
import { tokenize } from "./sessions/bm25";
import { buildCandidateTrustMetadata } from "./trust";
import { attachVerification } from "./verifier";
import { upsertInquiryRecord } from "./inquiries";
import type { CaptureCandidate, MemoryScope } from "./types";

export const CONSOLIDATION_PROMPT_TEMPLATE = `You are a memory extraction agent for a governed persistent intelligence system.

Analyze these user-authored conversation messages and extract ONLY durable patterns worth storing as long-term memory.
Every durable candidate must be grounded in user-authored input.
Do not infer a user preference merely from agent-generated workflow or orchestration text.

**Extract:**
1. Stable workflow preferences (e.g. "always write failing tests before implementation")
2. Tool or language preferences that surfaced during the session
3. Corrections the user made to agent behavior that should be avoided in future
4. Project conventions discovered that are non-obvious and reusable

**Do NOT extract:**
- One-time task details (what we built today, current file state)
- File contents, code snippets, or anything derivable from the codebase
- Ephemeral context or in-progress notes
- Anything already obvious from project config or AGENTS.md
- Activity summaries ("today we worked on X")

For each item, assign a confidence score (0–1). Only include items with confidence >= 0.75.
Aim for concise, falsifiable statements of 20–120 characters.

Every candidate MUST include at least one evidence item pointing to the numbered user messages below.
- message_index is the integer N from [User N].
- quote must be copied from that exact user message, not paraphrased or invented.
- Use the shortest quote that actually supports the candidate.
- If no exact user-authored quote supports a candidate, omit that candidate.

Respond ONLY with valid JSON, no commentary:
{
  "candidates": [
    {
      "statement": "concise durable statement",
      "tags": ["tag1", "tag2"],
      "confidence": 0.85,
      "evidence": [
        { "message_index": 0, "quote": "exact supporting text copied from [User 0]" }
      ]
    }
  ]
}

If nothing worth extracting, return: {"candidates": []}

===MESSAGES===
`;

export interface ConsolidationEvidenceRef {
  message_index: number;
  quote: string;
}

export interface ConsolidationResult {
  candidates_extracted: number;
  candidates_added: number;
  candidates_skipped_dedup: number;
  candidates_rejected_worth?: number;
  candidates_rejected_provenance?: number;
  candidates_daily_only?: number;
  inquiries_created?: number;
  status?: "ok" | "failed";
  failure_reason?: string;
  model_used?: string;
}

export interface RawCandidate {
  statement: string;
  tags: string[];
  confidence: number;
  evidence: ConsolidationEvidenceRef[];
  /** Legacy model field retained only so old output can be parsed and rejected for missing verifiable provenance. */
  evidence_hint?: string;
}

function consolidationUserMessages(userMessages: string[]): string[] {
  return userMessages.slice(-60).map((message) => message.slice(0, 500));
}

export function buildConsolidationPrompt(userMessages: string[], _assistantMessages: string[]): string {
  const lines = consolidationUserMessages(userMessages)
    .map((message, index) => `[User ${index}] ${message}`);
  return CONSOLIDATION_PROMPT_TEMPLATE + lines.join("\n");
}

function parseEvidenceRefs(value: unknown): ConsolidationEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const ref = item as { message_index?: unknown; quote?: unknown };
    if (!Number.isInteger(ref.message_index) || typeof ref.quote !== "string" || !ref.quote.trim()) return [];
    return [{ message_index: ref.message_index as number, quote: ref.quote }];
  });
}

export function parseConsolidationResponse(raw: string): RawCandidate[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { candidates?: unknown[] };
    if (!Array.isArray(parsed.candidates)) return [];
    return parsed.candidates.flatMap((value) => {
      if (typeof value !== "object" || value === null) return [];
      const item = value as Record<string, unknown>;
      if (typeof item.statement !== "string" || !item.statement.trim()) return [];
      if (typeof item.confidence !== "number" || item.confidence < 0.75) return [];
      return [{
        statement: item.statement,
        tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
        confidence: item.confidence,
        evidence: parseEvidenceRefs(item.evidence),
        evidence_hint: typeof item.evidence_hint === "string" ? item.evidence_hint : undefined,
      }];
    });
  } catch {
    return [];
  }
}

// ─── Jaccard deduplication ────────────────────────────────────────────

function jaccardSim(a: string, b: string): number {
  const aT = new Set(tokenize(a));
  const bT = new Set(tokenize(b));
  if (aT.size === 0 && bT.size === 0) return 1;
  const intersection = [...aT].filter((t) => bT.has(t)).length;
  const union = aT.size + bT.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

const DEDUP_THRESHOLD = 0.7;

function isDuplicate(statement: string, existing: string[]): boolean {
  return existing.some((e) => jaccardSim(statement, e) >= DEDUP_THRESHOLD);
}

function normalizeSupportText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

interface ValidatedSupport {
  message_index: number;
  quote: string;
}

function validatedSupports(candidate: RawCandidate, userMessages: string[]): ValidatedSupport[] {
  const seen = new Set<string>();
  const validated: ValidatedSupport[] = [];
  for (const ref of candidate.evidence) {
    if (!Number.isInteger(ref.message_index) || ref.message_index < 0 || ref.message_index >= userMessages.length) continue;
    const message = normalizeSupportText(userMessages[ref.message_index] ?? "");
    const quote = normalizeSupportText(ref.quote);
    if (!quote || !message.includes(quote)) continue;
    const key = `${ref.message_index}\n${quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    validated.push({ message_index: ref.message_index, quote });
  }
  return validated;
}

function evidenceScopeRef(scope: MemoryScope): string | undefined {
  if (scope.type === "project") return scope.project;
  if (scope.type === "domain") return scope.domains?.join(",");
  return undefined;
}

function consolidationSourceSessionId(sessionRef: string, userMessages: string[]): string {
  const digest = createHash("sha256")
    .update([sessionRef, ...userMessages.map(normalizeSupportText)].join("\n---\n"))
    .digest("hex")
    .slice(0, 24);
  return `consolidation-${digest}`;
}

function persistConsolidationEvidence(
  root: string,
  candidateId: string,
  supports: ValidatedSupport[],
  sessionRef: string,
  sourceSessionId: string,
  now: string,
): { ids: string[]; resource_id: string; profile_id: string; source_ref: string } {
  const profile = resolveMemoryProfile(root, sessionRef, now);
  const scope = inferProjectScope(sessionRef);
  const relatedMemoryId = candidateId.replace(/^cap_/, "mem_");
  const ids = supports.map((support) => {
    const sourceRef = `session:${sourceSessionId}:user:${support.message_index}`;
    const sourceExcerpt = boundSourceExcerpt(support.quote) ?? support.quote;
    const sourceSummary = boundSourceSummary(support.quote);
    const id = createEvidenceId({
      profile_id: profile.profile_id,
      source_session_id: sourceSessionId,
      source_kind: "conversation",
      source_ref: sourceRef,
      source_excerpt: sourceExcerpt,
      source_summary: sourceSummary,
    });
    const evidence = appendEvidenceRecordIfMissing(root, {
      id,
      resource_id: profile.resource_id,
      profile_id: profile.profile_id,
      source_session_id: sourceSessionId,
      created_at: now,
      source_kind: "conversation",
      source_ref: sourceRef,
      source_excerpt: sourceExcerpt,
      source_summary: sourceSummary,
      trust_class: "single_session_observation",
      polarity: "supports",
      durability_signal: "project",
      related_memory_ids: [relatedMemoryId],
      scope_level: scope.type,
      scope_ref: evidenceScopeRef(scope),
      tags: ["consolidation-provenance"],
      notes: `Validated against user-authored consolidation input [User ${support.message_index}].`,
    });
    return evidence.id;
  });
  return {
    ids,
    resource_id: profile.resource_id,
    profile_id: profile.profile_id,
    source_ref: `session:${sourceSessionId}:user:${supports[0].message_index}`,
  };
}

// ─── Apply ────────────────────────────────────────────────────────────

export function applyConsolidation(
  root: string,
  candidates: RawCandidate[],
  today: string,
  sessionRef: string,
  userMessages: string[] = [],
): ConsolidationResult {
  // Build dedup corpus from existing inbox + active L2 records
  const existingStatements: string[] = [
    ...listCandidates(root).filter((c) => c.status === "new").map((c) => c.text),
    ...loadActiveRecords(root).map((r) => r.statement),
  ];
  const sourceSessionId = consolidationSourceSessionId(sessionRef, userMessages);

  let added = 0;
  let skipped = 0;
  let rejectedWorth = 0;
  let rejectedProvenance = 0;
  let dailyOnly = 0;
  let inquiriesCreated = 0;

  for (const c of candidates) {
    if (isDuplicate(c.statement, existingStatements)) {
      skipped++;
      continue;
    }

    const supports = validatedSupports(c, userMessages);
    if (supports.length === 0) {
      rejectedProvenance++;
      continue;
    }

    const durableWorkflowTag = c.tags?.some((tag) => /testing|workflow/.test(tag)) ?? false;
    const worth = scoreMemoryWorth({ observation: c.statement, explicitUserRequest: durableWorkflowTag, evidenceStrength: 0.8, operationalImpact: c.tags?.some((tag) => /testing|workflow|release|security/.test(tag)) ? 0.8 : undefined, durability: "project", scope: sessionRef, existingStatements });
    if (worth.decision === "reject") {
      rejectedWorth++;
      continue;
    }
    if (worth.decision === "daily_only") {
      dailyOnly++;
      continue;
    }
    if (worth.decision === "inquiry") {
      upsertInquiryRecord(root, { question: c.statement, session_id: sessionRef, now: new Date().toISOString() });
      inquiriesCreated++;
      continue;
    }

    const now = new Date().toISOString();
    const candidateId = `cap_cons_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const provenance = persistConsolidationEvidence(root, candidateId, supports, sessionRef, sourceSessionId, now);
    let candidate: CaptureCandidate = withMemoryWorth({
      id: candidateId,
      resource_id: provenance.resource_id,
      profile_id: provenance.profile_id,
      thread_id: sourceSessionId,
      created_at: now,
      source: { type: "conversation", ref: provenance.source_ref, cwd: sessionRef },
      text: c.statement,
      tags: c.tags ?? [],
      evidence_refs: provenance.ids,
      evidence_ids: provenance.ids,
      confidence: c.confidence,
      status: "new",
      ...buildCandidateTrustMetadata("agent_inference", "project"),
    }, existingStatements);
    candidate = attachVerification(root, candidate);
    appendCandidate(root, candidate);
    existingStatements.push(c.statement); // prevent within-batch dups too
    added++;
  }

  return {
    candidates_extracted: candidates.length,
    candidates_added: added,
    candidates_skipped_dedup: skipped,
    candidates_rejected_worth: rejectedWorth,
    candidates_rejected_provenance: rejectedProvenance,
    candidates_daily_only: dailyOnly,
    inquiries_created: inquiriesCreated,
  };
}

// ─── Runner ──────────────────────────────────────────────────────────

export interface ConsolidationRunner {
  exec(command: string, args: string[], options?: { timeout?: number; cwd?: string }): Promise<{ stdout: string; stderr?: string; code: number }>;
}

export function buildConsolidationCommandArgs(prompt: string, model?: string | null): string[] {
  const args = ["-p", prompt, "--print", "--no-extensions", "--no-session"];
  if (model?.trim()) args.push("--model", model.trim());
  return args;
}

function failedConsolidation(reason: string, model?: string | null): ConsolidationResult {
  return {
    candidates_extracted: 0,
    candidates_added: 0,
    candidates_skipped_dedup: 0,
    status: "failed",
    failure_reason: reason.slice(0, 500),
    model_used: model?.trim() || undefined,
  };
}

export async function runConsolidation(
  root: string,
  userMessages: string[],
  assistantMessages: string[],
  today: string,
  sessionRef: string,
  runner: ConsolidationRunner,
  model?: string | null,
): Promise<ConsolidationResult> {
  const promptMessages = consolidationUserMessages(userMessages);
  const prompt = buildConsolidationPrompt(promptMessages, assistantMessages);

  let result: { stdout: string; stderr?: string; code: number };
  try {
    result = await Promise.race([
      runner.exec("pi", buildConsolidationCommandArgs(prompt, model), {
        timeout: 45_000,
        cwd: sessionRef,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("consolidation timeout")), 60_000)
      ),
    ]);
  } catch (err) {
    return failedConsolidation(err instanceof Error ? err.message : String(err), model);
  }

  if (result.code !== 0) {
    return failedConsolidation((result.stderr || result.stdout || `pi exited with code ${result.code}`).trim(), model);
  }
  if (!result.stdout.trim()) {
    return failedConsolidation("pi consolidation returned empty stdout", model);
  }

  const parsed = parseConsolidationResponse(result.stdout);
  return { ...applyConsolidation(root, parsed, today, sessionRef, promptMessages), status: "ok", model_used: model?.trim() || undefined };
}
