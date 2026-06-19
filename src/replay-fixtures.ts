import { readFileSync, writeFileSync } from "node:fs";
import { maybeCorrectionSignal, extractCorrectionCandidate } from "./corrections";
import { appendCandidate, listCandidates } from "./inbox";
import { scoreMemoryWorth } from "./memory-worth";
import { buildRecallXray } from "./recall-xray";
import { readRecentRuntimeEvents } from "./runtime-events";
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

export interface ReplayFixtureMetadata {
  fixture_id: string;
  fixture_kind: "synthetic" | "captured_style_synthetic" | "redacted_real";
  redaction_version: string;
  source_description: string;
  created_at: string;
  privacy_reviewed: boolean;
  contains_real_user_content: boolean;
}

export interface ReplayFixture {
  fixture_id: string;
  description: string;
  redaction_version: string;
  synthetic?: boolean;
  metadata?: ReplayFixtureMetadata;
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
  temporary_instruction_rejections: number;
  recalled_memory_ids: string[];
  expected_recall_hits: number;
  unexpected_recall_count: number;
  noise_count: number;
  privacy_leak_count: number;
  runtime_event_count: number;
  context_size: number;
  candidate_precision_proxy: number;
  failures: string[];
}

export function validateReplayFixture(value: unknown): value is ReplayFixture {
  const fixture = value as ReplayFixture;
  const baseValid = Boolean(fixture && typeof fixture.fixture_id === "string" && Array.isArray(fixture.sessions) && fixture.sessions.every((s) => typeof s.session_id === "string" && Array.isArray(s.turns) && s.turns.every((t) => ["user", "assistant", "tool"].includes(t.role) && typeof t.content === "string")) && fixture.expected && typeof fixture.redaction_version === "string");
  if (!baseValid) return false;
  if (!fixture.metadata) return fixture.synthetic === true || fixture.redaction_version.startsWith("synthetic");
  const m = fixture.metadata;
  return m.fixture_id === fixture.fixture_id
    && ["synthetic", "captured_style_synthetic", "redacted_real"].includes(m.fixture_kind)
    && m.redaction_version === fixture.redaction_version
    && typeof m.source_description === "string"
    && typeof m.created_at === "string"
    && m.privacy_reviewed === true
    && (m.contains_real_user_content === false || m.fixture_kind === "redacted_real");
}

export function validateReplayFixturePrivacy(fixture: ReplayFixture): string[] {
  const text = JSON.stringify(fixture);
  const findings = new Set<string>();
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) findings.add("email_like_string");
  if (/(?:\/home\/|\/Users\/|[A-Za-z]:\\)[^\s'\"]+/.test(text)) findings.add("absolute_private_path");
  if (/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|[A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|PASSWORD)[A-Z0-9_]*\s*=\s*\S+)/.test(text)) findings.add("token_like_secret");
  if (/\+\d[\d .()-]{8,}\d\b|\b\d{3}[ .()-]\d{3}[ .()-]\d{4}\b/.test(text)) findings.add("phone_like_string");
  return [...findings].sort();
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
  const invalid: ReplayResult = { fixture_id: "invalid", candidates_created: 0, rejected_observations: 0, temporary_instruction_rejections: 0, recalled_memory_ids: [], expected_recall_hits: 0, unexpected_recall_count: 0, noise_count: 0, privacy_leak_count: 0, runtime_event_count: 0, context_size: 0, candidate_precision_proxy: 0, failures: ["invalid_fixture"] };
  if (!validateReplayFixture(fixture)) return invalid;
  const privacyFindings = validateReplayFixturePrivacy(fixture);
  if (privacyFindings.length) return { ...invalid, fixture_id: fixture.fixture_id, failures: privacyFindings };

  const failures: string[] = [];
  let rejected = 0;
  let temporaryRejected = 0;
  for (const session of fixture.sessions) {
    for (const turn of session.turns) {
      if (turn.role !== "user") continue;
      const temporary = /for this one|just this once|one run|one-off/i.test(turn.content);
      const worth = scoreMemoryWorth({ observation: turn.content, explicitUserRequest: /always|never|prefer|don't|do not|this project uses|going forward/i.test(turn.content) && !temporary });
      if (worth.decision === "reject" || worth.decision === "daily_only" || turn.expected_no_capture || temporary) {
        rejected++;
        if (temporary) temporaryRejected++;
        continue;
      }
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
  const context = JSON.stringify(recall ?? {});
  for (const omitted of fixture.expected.expected_omissions ?? []) if (omitted && context.includes(omitted)) failures.push(`unexpected recall contained ${omitted}`);
  const candidates = listCandidates(root);
  const expectedCandidates = fixture.expected.candidates ?? [];
  const noise = candidates.filter((candidate) => !expectedCandidates.some((text) => candidate.text.includes(text))).length;
  const expectedHits = (fixture.expected.expected_recalled_memory_ids ?? []).filter((id) => recalled.includes(id)).length;
  const unexpectedRecall = recalled.filter((id) => !(fixture.expected.expected_recalled_memory_ids ?? []).includes(id)).length;
  const privacyLeaks = validateReplayFixturePrivacy({ ...fixture, expected: { ...fixture.expected, expected_omissions: [] } }).length;
  const precision = candidates.length === 0 ? (expectedCandidates.length === 0 ? 1 : 0) : Math.max(0, (candidates.length - noise) / candidates.length);
  const runtimeEventCount = readRecentRuntimeEvents(root, { hours: 24, minSeverity: "low" }).length;
  return {
    fixture_id: fixture.fixture_id,
    candidates_created: candidates.length,
    rejected_observations: rejected,
    temporary_instruction_rejections: temporaryRejected,
    recalled_memory_ids: recalled,
    expected_recall_hits: expectedHits,
    unexpected_recall_count: unexpectedRecall,
    noise_count: noise,
    privacy_leak_count: privacyLeaks,
    runtime_event_count: runtimeEventCount,
    context_size: context.length,
    candidate_precision_proxy: precision,
    failures,
  };
}
