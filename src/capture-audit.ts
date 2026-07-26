import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { classifyCaptureIntent } from "./capture-intent";
import { readCaptureCandidatesSnapshot, readMemoryRecordsSnapshot } from "./capture-report-snapshot";
import { ensureMemoryDirs } from "./paths";
import { redactSecrets, scanSecrets, shouldBlockPersistence } from "./secret-scanner";
import { parseSession } from "./sessions/parser";
import type { CaptureIntent, CaptureScopeTarget } from "./types";

export interface HistoricalPreferenceFinding {
  source_ref: string;
  source_hash: string;
  excerpt: string;
  intent: CaptureIntent;
  confidence: number;
  proposed_scope: CaptureScopeTarget;
  applicability: string[];
}

export interface CaptureAuditReport {
  generated_at: string;
  since?: string;
  mutation_performed: false;
  historical_preferences: HistoricalPreferenceFinding[];
  contaminated_record_ids: string[];
  contaminated_candidate_ids: string[];
  rescope_proposals: Array<{ record_id: string; from_project?: string; proposed_scope: "global"; reason: string }>;
  repeated_unreinforced_keys: string[];
  hidden_singleton_candidate_ids: string[];
  consolidation_failure_count: number;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sessionSummaryFiles(root: string): string[] {
  const directory = join(root, "sessions", "summaries");
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

function proposedScope(intent: ReturnType<typeof classifyCaptureIntent>): CaptureScopeTarget {
  const strongGlobalCue = intent.global_cues.some((cue) => !["\\bmy preference\\b", "\\bi prefer\\b", "\\bi do not like\\b"].includes(cue));
  if (strongGlobalCue) return { type: "global", confidence: 0.95, basis: ["explicit_user_global"] };
  if (intent.project_cues.length > 0 || intent.durability === "project") return { type: "project", confidence: 0.45, basis: ["historical_scope_requires_review"] };
  if (intent.intent === "user_preference") return { type: "global", confidence: 0.75, basis: ["historical_user_preference"] };
  return { type: "project", confidence: 0.45, basis: ["historical_scope_requires_review"] };
}

function summaryDate(content: string): string | null {
  return content.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] ?? null;
}

function preferenceSectionLines(content: string): string[] {
  const lines: string[] = [];
  let inPreferenceSection = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^#{1,6}\s+(?:Constraints\s*&\s*Preferences|Preferences)\s*$/i.test(line.trim())) {
      inPreferenceSection = true;
      continue;
    }
    if (/^#{1,6}\s+/.test(line.trim())) {
      inPreferenceSection = false;
      continue;
    }
    if (inPreferenceSection) lines.push(line);
  }
  return lines;
}

export function auditCaptureHistory(root: string, options: { since?: string; now?: string } = {}): CaptureAuditReport {
  const historicalPreferences: HistoricalPreferenceFinding[] = [];
  const seen = new Set<string>();
  const recurrenceKeys = new Map<string, number>();
  const addFinding = (rawLine: string, sourceRef: string): void => {
    const line = rawLine.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim();
    if (line.length < 8 || line.length > 500 || shouldBlockPersistence(scanSecrets(line))) return;
    if (/\b(?:was rejected as|was accepted as|was classified as|classified the message as|candidate was (?:created|rejected|accepted)|not_a_correction_signal)\b/i.test(line)) return;
    const decision = classifyCaptureIntent(line);
    if (!["user_preference", "behavior_correction", "project_convention", "workflow_playbook"].includes(decision.intent)) return;
    const normalized = `${decision.intent}:${line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    const occurrenceKey = hash(`${sourceRef}:${normalized}`);
    if (seen.has(occurrenceKey)) return;
    seen.add(occurrenceKey);
    recurrenceKeys.set(hash(normalized), (recurrenceKeys.get(hash(normalized)) ?? 0) + 1);
    historicalPreferences.push({
      source_ref: sourceRef,
      source_hash: hash(`${sourceRef}:${line}`),
      excerpt: redactSecrets(line).slice(0, 220),
      intent: decision.intent,
      confidence: decision.confidence,
      proposed_scope: proposedScope(decision),
      applicability: decision.applicability,
    });
  };

  const indexPath = join(root, "sessions", "session-index.jsonl");
  if (!existsSync(indexPath)) {
    for (const file of sessionSummaryFiles(root)) {
      const content = readFileSync(file, "utf-8");
      const date = summaryDate(content);
      if (options.since && date && date < options.since) continue;
      const sourceRef = `session-summary:${hash(file).slice(0, 16)}`;
      for (const line of preferenceSectionLines(content)) addFinding(line, sourceRef);
    }
  }

  if (existsSync(indexPath)) {
    for (const rawRow of readFileSync(indexPath, "utf-8").split(/\r?\n/)) {
      if (!rawRow.trim()) continue;
      let row: { id?: string; file?: string; date?: string };
      try { row = JSON.parse(rawRow) as typeof row; } catch { continue; }
      if (!row.file || !row.id || (options.since && row.date && row.date < options.since) || !existsSync(row.file)) continue;
      if (/(?:^|\/)run-\d+\/session\.jsonl$/i.test(row.file) || row.file.includes("/.pi-subagents/")) continue;
      try {
        if (statSync(row.file).size > 20_000_000) continue;
        const session = parseSession(row.file, false);
        if (!session || (options.since && session.date < options.since)) continue;
        session.userMessages.forEach((message, messageIndex) => {
          const wholeDecision = classifyCaptureIntent(message);
          if (wholeDecision.reasons.includes("task_or_agent_wrapper")) return;
          const sourceRef = `session-turn:${hash(row.id!).slice(0, 16)}:${messageIndex + 1}`;
          if (message.length <= 500) addFinding(message, sourceRef);
          else for (const line of message.split(/\r?\n/)) addFinding(line, sourceRef);
        });
        session.compactionSummaries.forEach((summary, summaryIndex) => {
          const sourceRef = `session-compaction:${hash(row.id!).slice(0, 16)}:${summaryIndex + 1}`;
          for (const line of preferenceSectionLines(summary)) addFinding(line, sourceRef);
        });
      } catch { continue; }
    }
  }

  const active = readMemoryRecordsSnapshot(root).filter((record) => record.status === "active");
  const contaminated = active.filter((record) => /^(?:task:|your goal is|you are a delegated|you are a subagent|<file name=|# instructions)/i.test(record.statement.trim())).map((record) => record.id);
  const rescope = active.filter((record) =>
    record.scope.type === "project"
    && /\b(across projects|for any project|all public repositor|whenever you write for me|my preference)\b/i.test(record.statement)
  ).map((record) => ({ record_id: record.id, from_project: record.scope.project, proposed_scope: "global" as const, reason: "global_language_in_project_scope" }));

  const allCandidates = readCaptureCandidatesSnapshot(root);
  const candidates = allCandidates.filter((candidate) => candidate.status === "new");
  const contaminatedCandidates = allCandidates.filter((candidate) => /^(?:task:|your goal is|you are a delegated|you are a subagent|<file name=|# instructions)/i.test(candidate.text.trim())).map((candidate) => candidate.id);

  const runtimeEventsPath = join(root, "runtime", "events.jsonl");
  const consolidationFailureCount = existsSync(runtimeEventsPath)
    ? readFileSync(runtimeEventsPath, "utf-8").split(/\r?\n/).filter((line) => /consolidation.*fail/i.test(line)).length
    : 0;

  return {
    generated_at: options.now ?? new Date().toISOString(),
    since: options.since,
    mutation_performed: false,
    historical_preferences: historicalPreferences,
    contaminated_record_ids: contaminated,
    contaminated_candidate_ids: contaminatedCandidates,
    rescope_proposals: rescope,
    repeated_unreinforced_keys: [...recurrenceKeys.entries()].filter(([, count]) => count > 1).map(([key]) => key),
    hidden_singleton_candidate_ids: candidates.length === 1 ? [candidates[0].id] : [],
    consolidation_failure_count: consolidationFailureCount,
  };
}

export function renderCaptureAuditReport(report: CaptureAuditReport): string {
  return [
    "# Memory Capture Audit",
    "",
    `Generated: ${report.generated_at}`,
    `Mutation performed: ${report.mutation_performed}`,
    "",
    `## Historical preferences (${report.historical_preferences.length})`,
    ...report.historical_preferences.map((item) => `- [${item.intent}, ${item.proposed_scope.type}] ${item.excerpt}`),
    "",
    `## Contaminated records (${report.contaminated_record_ids.length})`,
    ...report.contaminated_record_ids.map((id) => `- ${id}`),
    "",
    `## Contaminated candidates (${report.contaminated_candidate_ids.length})`,
    ...report.contaminated_candidate_ids.map((id) => `- ${id}`),
    "",
    `## Rescope proposals (${report.rescope_proposals.length})`,
    ...report.rescope_proposals.map((item) => `- ${item.record_id}: ${item.from_project ?? "unknown"} to global`),
    "",
    `Consolidation failures: ${report.consolidation_failure_count}`,
  ].join("\n");
}
