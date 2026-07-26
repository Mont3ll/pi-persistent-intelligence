import { existsSync, statSync } from "node:fs";
import { readJsonl } from "./jsonl";
import { resolvePaths } from "./paths";
import { readCaptureCandidatesSnapshot, readMemoryRecordsSnapshot } from "./capture-report-snapshot";
import type { CaptureEvent } from "./capture-coordinator";
import type { CaptureEventOutcome } from "./types";

export interface CaptureQualityReport {
  generated_at: string;
  mutation_performed: false;
  messages_evaluated: number;
  funnel: Record<CaptureEventOutcome | "rejected", number>;
  rejection_reasons: Record<string, number>;
  scope_distribution: Record<string, number>;
  active_global_preferences: number;
  active_project_conventions: number;
  pending_candidates: number;
  repeated_pending_preferences: number;
  runtime_bytes: number;
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

export function buildCaptureQualityReport(root: string, options: { now?: string } = {}): CaptureQualityReport {
  const paths = resolvePaths(root);
  const events = readJsonl<CaptureEvent>(paths.runtime.captureEvents);
  const candidates = readCaptureCandidatesSnapshot(root);
  const records = readMemoryRecordsSnapshot(root).filter((record) => record.status === "active");
  const funnel = {
    detected: 0,
    rejected: 0,
    daily_only: 0,
    inquiry: 0,
    candidate_created: 0,
    candidate_reinforced: 0,
    candidate_promoted: 0,
    candidate_rejected: 0,
  } satisfies Record<CaptureEventOutcome | "rejected", number>;
  const rejectionReasons: Record<string, number> = {};
  const scopeDistribution: Record<string, number> = {};

  for (const event of events) {
    if (event.outcome === "rejected") {
      funnel.rejected++;
      increment(rejectionReasons, event.reason);
    } else {
      funnel[event.outcome]++;
    }
    for (const scope of event.scope_types) increment(scopeDistribution, scope);
  }

  const runtimeBytes = [paths.runtime.captureActivity, paths.runtime.captureCheckpoints, paths.runtime.captureEvents]
    .reduce((total, path) => total + (existsSync(path) ? statSync(path).size : 0), 0);

  return {
    generated_at: options.now ?? new Date().toISOString(),
    mutation_performed: false,
    messages_evaluated: events.length,
    funnel,
    rejection_reasons: rejectionReasons,
    scope_distribution: scopeDistribution,
    active_global_preferences: records.filter((record) => record.scope.type === "global" && record.ruleType === "preference").length,
    active_project_conventions: records.filter((record) => record.scope.type === "project" && record.ruleType === "convention").length,
    pending_candidates: candidates.filter((candidate) => candidate.status === "new").length,
    repeated_pending_preferences: candidates.filter((candidate) => candidate.status === "new" && (candidate.recurrence_count ?? 0) > 1).length,
    runtime_bytes: runtimeBytes,
  };
}

export function renderCaptureQualityReport(report: CaptureQualityReport): string {
  return [
    "# Memory Capture Quality",
    "",
    `Generated: ${report.generated_at}`,
    `Messages evaluated: ${report.messages_evaluated}`,
    `Candidates created: ${report.funnel.candidate_created}`,
    `Candidates reinforced: ${report.funnel.candidate_reinforced}`,
    `Rejected: ${report.funnel.rejected}`,
    `Pending candidates: ${report.pending_candidates}`,
    `Repeated pending preferences: ${report.repeated_pending_preferences}`,
    `Active global preferences: ${report.active_global_preferences}`,
    `Active project conventions: ${report.active_project_conventions}`,
    `Runtime capture bytes: ${report.runtime_bytes}`,
    "",
    "## Rejection reasons",
    ...Object.entries(report.rejection_reasons).sort(([a], [b]) => a.localeCompare(b)).map(([reason, count]) => `- ${reason}: ${count}`),
    "",
    "## Scope distribution",
    ...Object.entries(report.scope_distribution).sort(([a], [b]) => a.localeCompare(b)).map(([scope, count]) => `- ${scope}: ${count}`),
  ].join("\n");
}
