/**
 * Consolidator — extracts L2 memory candidates from session conversation.
 *
 * Includes Jaccard deduplication: candidates with >0.7 token overlap against
 * existing inbox items or active L2 records are silently skipped.
 */
import { appendCandidate, listCandidates, withMemoryWorth } from "./inbox";
import { loadActiveRecords } from "./store";
import { tokenize } from "./sessions/bm25";
import { buildCandidateTrustMetadata } from "./trust";
import { scoreMemoryWorth } from "./memory-worth";
import { upsertInquiryRecord } from "./inquiries";
import type { CaptureCandidate } from "./types";

export const CONSOLIDATION_PROMPT_TEMPLATE = `You are a memory extraction agent for a governed persistent intelligence system.

Analyze these conversation messages and extract ONLY durable patterns worth storing as long-term memory.

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

Respond ONLY with valid JSON, no commentary:
{
  "candidates": [
    {
      "statement": "concise durable statement",
      "tags": ["tag1", "tag2"],
      "confidence": 0.85,
      "evidence_hint": "brief note about what conversation turn supports this"
    }
  ]
}

If nothing worth extracting, return: {"candidates": []}

===MESSAGES===
`;

export interface ConsolidationResult {
  candidates_extracted: number;
  candidates_added: number;
  candidates_skipped_dedup: number;
  candidates_rejected_worth?: number;
  candidates_daily_only?: number;
  inquiries_created?: number;
}

export interface RawCandidate {
  statement: string;
  tags: string[];
  confidence: number;
  evidence_hint: string;
}

export function buildConsolidationPrompt(userMessages: string[], assistantMessages: string[]): string {
  const lines: string[] = [];
  const maxMessages = 60;
  const uSlice = userMessages.slice(-maxMessages);
  const aSlice = assistantMessages.slice(-maxMessages);
  const total = Math.max(uSlice.length, aSlice.length);
  for (let i = 0; i < total; i++) {
    if (uSlice[i]) lines.push(`[User] ${uSlice[i].slice(0, 500)}`);
    if (aSlice[i]) lines.push(`[Assistant] ${aSlice[i].slice(0, 300)}`);
  }
  return CONSOLIDATION_PROMPT_TEMPLATE + lines.join("\n");
}

export function parseConsolidationResponse(raw: string): RawCandidate[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { candidates?: unknown[] };
    if (!Array.isArray(parsed.candidates)) return [];
    return parsed.candidates.filter((c): c is RawCandidate =>
      typeof c === "object" && c !== null &&
      typeof (c as RawCandidate).statement === "string" &&
      (c as RawCandidate).statement.trim().length > 0 &&
      typeof (c as RawCandidate).confidence === "number" &&
      (c as RawCandidate).confidence >= 0.75
    );
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

// ─── Apply ────────────────────────────────────────────────────────────

export function applyConsolidation(
  root: string,
  candidates: RawCandidate[],
  today: string,
  sessionRef: string,
): ConsolidationResult {
  // Build dedup corpus from existing inbox + active L2 records
  const existingStatements: string[] = [
    ...listCandidates(root).filter((c) => c.status === "new").map((c) => c.text),
    ...loadActiveRecords(root).map((r) => r.statement),
  ];

  let added = 0;
  let skipped = 0;
  let rejectedWorth = 0;
  let dailyOnly = 0;
  let inquiriesCreated = 0;

  for (const c of candidates) {
    if (isDuplicate(c.statement, existingStatements)) {
      skipped++;
      continue;
    }

    const durableWorkflowTag = c.tags?.some((tag) => /testing|workflow/.test(tag)) ?? false;
    const worth = scoreMemoryWorth({ observation: c.statement, explicitUserRequest: durableWorkflowTag, evidenceStrength: 0.7, operationalImpact: c.tags?.some((tag) => /testing|workflow|release|security/.test(tag)) ? 0.8 : undefined, durability: "project", scope: sessionRef, existingStatements });
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

    const candidate: CaptureCandidate = withMemoryWorth({
      id: `cap_cons_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      created_at: new Date().toISOString(),
      source: { type: "conversation", ref: `daily/${today}.md`, cwd: sessionRef },
      text: c.statement,
      tags: c.tags ?? [],
      evidence_refs: [`daily/${today}.md`],
      confidence: c.confidence,
      status: "new",
      ...buildCandidateTrustMetadata("agent_inference", "project"),
    }, existingStatements);
    appendCandidate(root, candidate);
    existingStatements.push(c.statement); // prevent within-batch dups too
    added++;
  }

  return { candidates_extracted: candidates.length, candidates_added: added, candidates_skipped_dedup: skipped, candidates_rejected_worth: rejectedWorth, candidates_daily_only: dailyOnly, inquiries_created: inquiriesCreated };
}

// ─── Runner ───────────────────────────────────────────────────────────

export interface ConsolidationRunner {
  exec(command: string, args: string[], options?: { timeout?: number; cwd?: string }): Promise<{ stdout: string; code: number }>;
}

export async function runConsolidation(
  root: string,
  userMessages: string[],
  assistantMessages: string[],
  today: string,
  sessionRef: string,
  runner: ConsolidationRunner,
  model = "claude-haiku-4-5-20251001",
): Promise<ConsolidationResult> {
  const prompt = buildConsolidationPrompt(userMessages, assistantMessages);

  const result = await Promise.race([
    runner.exec("pi", ["-p", prompt, "--print", "--no-extensions", "--model", model], {
      timeout: 45_000,
      cwd: sessionRef,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("consolidation timeout")), 60_000)
    ),
  ]);

  if (result.code !== 0 || !result.stdout) {
    return { candidates_extracted: 0, candidates_added: 0, candidates_skipped_dedup: 0 };
  }

  const parsed = parseConsolidationResponse(result.stdout);
  return applyConsolidation(root, parsed, today, sessionRef);
}
