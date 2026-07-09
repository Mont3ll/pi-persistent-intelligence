import { listCandidates } from "./inbox";
import { analyzeMemoryQuality, type MemoryQualityReport } from "./memory-quality";
import { analyzeRecallEffectiveness, type RecallEffectivenessReport } from "./recall-effectiveness";
import { analyzeRelationshipQuality, type RelationshipQualityReport } from "./relationship-quality";
import { readRecentRuntimeEvents } from "./runtime-events";
import { redactSecrets, redactSecretsInObject } from "./secret-scanner";
import { loadAllRecords } from "./store";

export type StoreQualityMetricId = "memory_quality" | "relationship_quality" | "recall_effectiveness" | "governance" | "inbox" | "runtime";
export type StoreQualityStatus = "healthy" | "watch" | "attention";

export interface StoreQualityMetric {
  id: StoreQualityMetricId;
  label: string;
  score: number;
  status: StoreQualityStatus;
  summary: string;
  signals: string[];
  mutation_performed: false;
}

export interface StoreQualityRecommendation {
  id: string;
  metric_id: StoreQualityMetricId;
  summary: string;
  reason: string;
  review_required: true;
  mutation_performed: false;
}

export interface StoreQualityReport {
  generated_at: string;
  overall_score: number;
  status: StoreQualityStatus;
  metrics: StoreQualityMetric[];
  recommendations: StoreQualityRecommendation[];
  inputs: {
    memory_quality_average: number;
    relationship_quality_average: number;
    recall_effectiveness_average: number;
    active_memories: number;
    pending_candidates: number;
    runtime_warnings: number;
  };
  mutation_performed: false;
}

export interface AnalyzeStoreQualityOptions { now?: string; }

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function statusFor(score: number): StoreQualityStatus {
  if (score < 70) return "attention";
  if (score < 85) return "watch";
  return "healthy";
}

function metric(input: Omit<StoreQualityMetric, "status" | "mutation_performed">): StoreQualityMetric {
  const score = clampScore(input.score);
  return { ...input, score, status: statusFor(score), mutation_performed: false };
}

function recommendation(metricId: StoreQualityMetricId, summary: string, reason: string): StoreQualityRecommendation {
  return { id: `sq_${metricId}`, metric_id: metricId, summary, reason, review_required: true, mutation_performed: false };
}

export function buildStoreQualityReport(input: {
  generated_at: string;
  memory: MemoryQualityReport;
  relationships: RelationshipQualityReport;
  recall: RecallEffectivenessReport;
  activeMemories: number;
  pendingCandidates: number;
  runtimeWarnings: number;
  governanceSignals?: string[];
}): StoreQualityReport {
  const governanceSignals = input.governanceSignals ?? [];
  const metrics: StoreQualityMetric[] = [
    metric({
      id: "memory_quality",
      label: "Memory Quality",
      score: input.memory.summary.average_quality,
      summary: `${input.memory.summary.low_quality_count} low-quality, ${input.memory.summary.stale_count} stale, ${input.memory.summary.duplicate_signal_count} duplicate signal(s).`,
      signals: [
        ...(input.memory.summary.low_quality_count ? ["low_quality_memories"] : []),
        ...(input.memory.summary.stale_count ? ["stale_memories"] : []),
        ...(input.memory.summary.duplicate_signal_count ? ["duplicate_memory_signals"] : []),
      ],
    }),
    metric({
      id: "relationship_quality",
      label: "Relationship Quality",
      score: input.relationships.summary.average_relationship_quality,
      summary: `${input.relationships.summary.weak_edge_count} weak edge(s), ${input.relationships.summary.orphan_memory_count} orphan memory signal(s), ${input.relationships.summary.dead_end_memory_count} dead end(s).`,
      signals: [
        ...(input.relationships.summary.weak_edge_count ? ["weak_relationships"] : []),
        ...(input.relationships.summary.orphan_memory_count ? ["orphan_memories"] : []),
        ...(input.relationships.summary.cyclic_memory_pair_count ? ["cyclic_relationships"] : []),
      ],
    }),
    metric({
      id: "recall_effectiveness",
      label: "Recall Effectiveness",
      score: input.recall.summary.average_effectiveness,
      summary: `${input.recall.summary.never_recalled_count} never recalled, ${input.recall.summary.corrected_after_recall_count} corrected after recall, ${input.recall.summary.total_events} recall event(s).`,
      signals: [
        ...(input.recall.summary.never_recalled_count ? ["never_recalled_memories"] : []),
        ...(input.recall.summary.corrected_after_recall_count ? ["recalled_then_corrected"] : []),
      ],
    }),
    metric({
      id: "governance",
      label: "Governance",
      score: 100 - governanceSignals.length * 15,
      summary: governanceSignals.length ? `${governanceSignals.length} governance signal(s) require review.` : "No store-wide governance signals detected.",
      signals: governanceSignals,
    }),
    metric({
      id: "inbox",
      label: "Inbox Pressure",
      score: input.pendingCandidates === 0 ? 100 : input.pendingCandidates <= 5 ? 85 : input.pendingCandidates <= 20 ? 70 : 50,
      summary: `${input.pendingCandidates} pending candidate(s).`,
      signals: input.pendingCandidates > 20 ? ["high_inbox_pressure"] : input.pendingCandidates > 0 ? ["pending_candidates"] : [],
    }),
    metric({
      id: "runtime",
      label: "Runtime Stability",
      score: input.runtimeWarnings === 0 ? 100 : input.runtimeWarnings <= 2 ? 85 : input.runtimeWarnings <= 8 ? 70 : 50,
      summary: `${input.runtimeWarnings} medium/high runtime warning or error event(s) in the recent window.`,
      signals: input.runtimeWarnings ? ["recent_runtime_warnings"] : [],
    }),
  ];

  const overall = clampScore(metrics.reduce((sum, item) => sum + item.score, 0) / Math.max(1, metrics.length));
  const recommendations = metrics
    .filter((item) => item.score < 85 || item.signals.length > 0)
    .map((item) => recommendation(item.id, `Review ${item.label.toLowerCase()}`, item.summary));

  return redactSecretsInObject({
    generated_at: input.generated_at,
    overall_score: overall,
    status: statusFor(overall),
    metrics,
    recommendations,
    inputs: {
      memory_quality_average: input.memory.summary.average_quality,
      relationship_quality_average: input.relationships.summary.average_relationship_quality,
      recall_effectiveness_average: input.recall.summary.average_effectiveness,
      active_memories: input.activeMemories,
      pending_candidates: input.pendingCandidates,
      runtime_warnings: input.runtimeWarnings,
    },
    mutation_performed: false,
  }) as StoreQualityReport;
}

export function analyzeStoreQuality(root: string, options: AnalyzeStoreQualityOptions = {}): StoreQualityReport {
  const now = options.now ?? new Date().toISOString();
  const records = loadAllRecords(root);
  const candidates = listCandidates(root).filter((candidate) => candidate.status === "new");
  const runtimeWarnings = readRecentRuntimeEvents(root, { hours: 48, minSeverity: "medium", now }).filter((event) => event.type === "warn" || event.type === "error").length;
  const governanceSignals = [
    ...(records.some((record) => record.status === "active" && record.evidence.length === 0) ? ["active_memory_missing_evidence"] : []),
    ...(records.some((record) => record.status === "contested") ? ["contested_memory"] : []),
  ];
  return buildStoreQualityReport({
    generated_at: now,
    memory: analyzeMemoryQuality(root, { now }),
    relationships: analyzeRelationshipQuality(root, { now }),
    recall: analyzeRecallEffectiveness(root, { now }),
    activeMemories: records.filter((record) => record.status === "active").length,
    pendingCandidates: candidates.length,
    runtimeWarnings,
    governanceSignals,
  });
}

export function renderStoreQualityReport(report: StoreQualityReport): string {
  return redactSecrets([
    "# PI Store Quality Dashboard",
    "",
    `Generated: ${report.generated_at}`,
    `Overall store quality: ${report.overall_score}/100 [${report.status}]`,
    `Inputs: ${report.inputs.active_memories} active memories · ${report.inputs.pending_candidates} pending candidates · ${report.inputs.runtime_warnings} runtime warnings`,
    "",
    "## Metrics",
    ...report.metrics.map((item) => `- ${item.label}: ${item.score}/100 [${item.status}] — ${item.summary}`),
    "",
    "## Recommendations",
    ...(report.recommendations.length ? report.recommendations.map((rec) => `- ${rec.summary}: ${rec.reason} Review required; No automatic mutation performed.`) : ["- No review recommendations. No automatic mutation performed."]),
  ].join("\n"));
}
