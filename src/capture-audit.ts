import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyCaptureIntent } from "./capture-intent";
import { listCandidates } from "./inbox";
import { ensureMemoryDirs } from "./paths";
import { redactSecrets, scanSecrets, shouldBlockPersistence } from "./secret-scanner";
import { loadAllRecords } from "./store";
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
  if (intent.global_cues.length > 0 || intent.intent === "user_preference") return { type: "global", confidence: intent.global_cues.length ? 0.95 : 0.75, basis: [intent.global_cues.length ? "explicit_user_global" : "historical_user_preference"] };
  return { type: "project", confidence: 0.45, basis: ["historical_scope_requires_review"] };
}

function summaryDate(content: string): string | null {
  return content.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] ?? null;
}

export function auditCaptureHistory(root: string, options: { since?: string; now?: string } = {}): CaptureAuditReport {
  const historicalPreferences: HistoricalPreferenceFinding[] = [];
  const seen = new Set<string>();
  for (const file of sessionSummaryFiles(root)) {
    const content = readFileSync(file, "utf-8");
    const date = summaryDate(content);
    if (options.since && date && date < options.since) continue;
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim();
      if (line.length < 8 || line.length > 500 || shouldBlockPersistence(scanSecrets(line))) continue;
      const decision = classifyCaptureIntent(line);
      if (!["user_preference", "behavior_correction", "project_convention", "workflow_playbook"].includes(decision.intent)) continue;
      const key = hash(`${decision.intent}:${line.toLowerCase().replace(/[^a-z0-9]+/g, " ")}`);
      if (seen.has(key)) continue;
      seen.add(key);
      historicalPreferences.push({
        source_ref: `session-summary:${hash(file).slice(0, 16)}`,
        source_hash: hash(line),
        excerpt: redactSecrets(line).slice(0, 220),
        intent: decision.intent,
        confidence: decision.confidence,
        proposed_scope: proposedScope(decision),
        applicability: decision.applicability,
      });
    }
  }

  const active = loadAllRecords(root).filter((record) => record.status === "active");
  const contaminated = active.filter((record) => /^(?:task:|your goal is|you are a delegated|you are a subagent|<file name=|# instructions)/i.test(record.statement.trim())).map((record) => record.id);
  const rescope = active.filter((record) =>
    record.scope.type === "project"
    && /\b(across projects|for any project|all public repositor|whenever you write for me|my preference)\b/i.test(record.statement)
  ).map((record) => ({ record_id: record.id, from_project: record.scope.project, proposed_scope: "global" as const, reason: "global_language_in_project_scope" }));

  const candidates = listCandidates(root).filter((candidate) => candidate.status === "new");
  const keyCounts = new Map<string, number>();
  for (const finding of historicalPreferences) keyCounts.set(finding.source_hash, (keyCounts.get(finding.source_hash) ?? 0) + 1);
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
    rescope_proposals: rescope,
    repeated_unreinforced_keys: [...keyCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key),
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
    `## Rescope proposals (${report.rescope_proposals.length})`,
    ...report.rescope_proposals.map((item) => `- ${item.record_id}: ${item.from_project ?? "unknown"} to global`),
    "",
    `Consolidation failures: ${report.consolidation_failure_count}`,
  ].join("\n");
}
