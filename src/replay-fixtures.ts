import { readFileSync, writeFileSync } from "node:fs";
import { maybeCorrectionSignal, extractCorrectionCandidate } from "./corrections";
import { appendCandidate, listCandidates } from "./inbox";
import { scoreMemoryWorth } from "./memory-worth";
import { buildRecallXray } from "./recall-xray";
import { unsafeAddMemoryRecord } from "./store";
import type { MemoryRecord } from "./types";

export interface ReplayTurn {
  role: "user" | "assistant" | "tool";
  content: string;
  tags?: string[];
  expected_capture?: boolean;
  expected_recall?: string[];
  expected_no_capture?: boolean;
}

export interface ReplayFixture {
  fixture_id: string;
  description: string;
  redaction_version: string;
  synthetic?: boolean;
  sessions: Array<{ session_id: string; turns: ReplayTurn[] }>;
  expected: {
    candidates?: string[];
    inquiries?: string[];
    rejected?: string[];
    recall_query?: string;
    expected_recalled_memory_ids?: string[];
    expected_omissions?: string[];
  };
}

export interface ReplayResult {
  fixture_id: string;
  candidates_created: number;
  rejected_observations: number;
  recalled_memory_ids: string[];
  noise_count: number;
  failures: string[];
}

export function validateReplayFixture(value: unknown): value is ReplayFixture {
  const fixture = value as ReplayFixture;
  return Boolean(fixture && typeof fixture.fixture_id === "string" && Array.isArray(fixture.sessions) && fixture.sessions.every((s) => typeof s.session_id === "string" && Array.isArray(s.turns)) && fixture.expected && typeof fixture.redaction_version === "string");
}

export function redactReplayContent(input: string, options: { redactUrls?: boolean } = {}): string {
  let out = input
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted_email]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|[A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|PASSWORD)[A-Z0-9_]*\s*=\s*\S+)/g, "[redacted_secret]")
    .replace(/(?:\/home\/|\/Users\/)[^\s'\"]+/g, "[redacted_path]")
    .replace(/\b\+?\d[\d .()-]{8,}\d\b/g, "[redacted_phone]");
  if (options.redactUrls) out = out.replace(/https?:\/\/\S+/g, "[redacted_url]");
  return out;
}

export function redactReplayFixture(fixture: ReplayFixture): ReplayFixture {
  return {
    ...fixture,
    sessions: fixture.sessions.map((session) => ({ ...session, turns: session.turns.map((turn) => ({ ...turn, content: redactReplayContent(turn.content, { redactUrls: true }) })) })),
  };
}

export function redactReplayFixtureFile(inputPath: string, outputPath: string): void {
  const fixture = JSON.parse(readFileSync(inputPath, "utf-8")) as ReplayFixture;
  writeFileSync(outputPath, `${JSON.stringify(redactReplayFixture(fixture), null, 2)}\n`, "utf-8");
}

function record(id: string, statement: string): MemoryRecord {
  return { id, layer: "L2", scope: { type: "global" }, tags: ["testing"], statement, evidence: [{ type: "manual", ref: "fixture", note: "fixture" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-06-15", updated_at: "2026-06-15", review: { cadence_days: 30, next_review: "2026-07-15", change_condition: "If contradicted." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null, ruleType: "workflow" };
}

export function runReplayFixture(root: string, fixture: ReplayFixture): ReplayResult {
  if (!validateReplayFixture(fixture)) return { fixture_id: "invalid", candidates_created: 0, rejected_observations: 0, recalled_memory_ids: [], noise_count: 0, failures: ["invalid_fixture"] };
  const failures: string[] = [];
  let rejected = 0;
  for (const session of fixture.sessions) {
    for (const turn of session.turns) {
      if (turn.role !== "user") continue;
      const worth = scoreMemoryWorth({ observation: turn.content, explicitUserRequest: /always|never|prefer|don't|do not|this project uses/i.test(turn.content) });
      if (worth.decision === "reject" || worth.decision === "daily_only" || turn.expected_no_capture || /for this one|just this once|one run/i.test(turn.content)) rejected++;
      if (maybeCorrectionSignal(turn.content)) {
        const cand = extractCorrectionCandidate(turn.content, "2026-06-15", "/redacted/project");
        if (cand && worth.decision === "candidate") appendCandidate(root, { ...cand, thread_id: session.session_id });
      }
    }
  }
  for (const expected of fixture.expected.candidates ?? []) unsafeAddMemoryRecord(root, record(`mem_${expected.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`, expected));
  const recall = fixture.expected.recall_query ? buildRecallXray(root, { query: fixture.expected.recall_query }) : undefined;
  const recalled = recall?.included.map((item) => item.memory_id) ?? [];
  for (const id of fixture.expected.expected_recalled_memory_ids ?? []) if (!recalled.includes(id)) failures.push(`expected recall missing ${id}`);
  const noise = listCandidates(root).filter((candidate) => !(fixture.expected.candidates ?? []).some((text) => candidate.text.includes(text))).length;
  return { fixture_id: fixture.fixture_id, candidates_created: listCandidates(root).length, rejected_observations: rejected, recalled_memory_ids: recalled, noise_count: noise, failures };
}
