import { readRecallEvents, type RecallEvent } from "./recall-events";
import { redactSecrets, redactSecretsInObject } from "./secret-scanner";
import { loadAllRecords } from "./store";
import type { MemoryRecord } from "./types";

export interface RecallMemoryStat {
  memory_id: string;
  status: MemoryRecord["status"];
  layer: MemoryRecord["layer"];
  selected_count: number;
  excluded_count: number;
  correction_count: number;
  last_recalled_at?: string;
  effectiveness_score: number;
  signals: string[];
  mutation_performed: false;
}

export interface RecallEffectivenessRecommendation {
  id: string;
  memory_id: string;
  summary: string;
  reason: string;
  review_required: true;
  mutation_performed: false;
}

export interface RecallEffectivenessReport {
  generated_at: string;
  summary: {
    total_events: number;
    selected_memory_count: number;
    never_recalled_count: number;
    corrected_after_recall_count: number;
    average_effectiveness: number;
  };
  memory_stats: RecallMemoryStat[];
  recommendations: RecallEffectivenessRecommendation[];
  mutation_performed: false;
}

export interface AnalyzeRecallEffectivenessOptions { now?: string; }

function scoreFor(selected: number, excluded: number, corrections: number): number {
  if (selected === 0 && excluded === 0) return 50;
  const score = 70 + Math.min(20, selected * 5) - Math.min(25, excluded * 5) - Math.min(35, corrections * 20);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function lastRecall(memoryId: string, events: RecallEvent[]): string | undefined {
  return events
    .filter((event) => event.selected_memory_ids.includes(memoryId) || event.excluded_memory_ids.includes(memoryId))
    .map((event) => event.timestamp)
    .sort()
    .at(-1);
}

function recommendationFor(stat: RecallMemoryStat): RecallEffectivenessRecommendation | null {
  if (stat.signals.length === 0 && stat.effectiveness_score >= 70) return null;
  return {
    id: `re_${stat.memory_id}`,
    memory_id: stat.memory_id,
    summary: `Review recall effectiveness for ${stat.memory_id}`,
    reason: stat.signals.length ? stat.signals.join(", ") : `effectiveness score ${stat.effectiveness_score}/100`,
    review_required: true,
    mutation_performed: false,
  };
}

export function analyzeRecallEffectiveness(root: string, options: AnalyzeRecallEffectivenessOptions = {}): RecallEffectivenessReport {
  const now = options.now ?? new Date().toISOString();
  const records = loadAllRecords(root);
  const events = readRecallEvents(root);
  const selectedCounts = new Map<string, number>();
  const excludedCounts = new Map<string, number>();
  const correctionCounts = new Map<string, number>();

  for (const event of events) {
    for (const id of event.selected_memory_ids) selectedCounts.set(id, (selectedCounts.get(id) ?? 0) + 1);
    for (const id of event.excluded_memory_ids) excludedCounts.set(id, (excludedCounts.get(id) ?? 0) + 1);
    if (event.outcome === "corrected" || event.source === "correction") {
      for (const id of event.selected_memory_ids) correctionCounts.set(id, (correctionCounts.get(id) ?? 0) + 1);
    }
  }

  const memoryStats: RecallMemoryStat[] = records.map((record) => {
    const selected = selectedCounts.get(record.id) ?? 0;
    const excluded = excludedCounts.get(record.id) ?? 0;
    const corrections = correctionCounts.get(record.id) ?? 0;
    const signals: string[] = [];
    if (selected === 0 && record.status === "active") signals.push("never_recalled");
    if (excluded > selected) signals.push("frequently_excluded");
    if (corrections > 0) signals.push("recalled_then_corrected");
    if (selected >= 3 && corrections === 0) signals.push("frequently_recalled");
    return {
      memory_id: record.id,
      status: record.status,
      layer: record.layer,
      selected_count: selected,
      excluded_count: excluded,
      correction_count: corrections,
      last_recalled_at: lastRecall(record.id, events),
      effectiveness_score: scoreFor(selected, excluded, corrections),
      signals,
      mutation_performed: false as const,
    };
  }).sort((a, b) => a.effectiveness_score - b.effectiveness_score || b.selected_count - a.selected_count || a.memory_id.localeCompare(b.memory_id));

  const recommendations = memoryStats.flatMap((stat) => recommendationFor(stat) ? [recommendationFor(stat)!] : []);
  const avg = memoryStats.length ? Math.round(memoryStats.reduce((sum, stat) => sum + stat.effectiveness_score, 0) / memoryStats.length) : 100;

  return redactSecretsInObject({
    generated_at: now,
    summary: {
      total_events: events.length,
      selected_memory_count: [...selectedCounts.keys()].length,
      never_recalled_count: memoryStats.filter((stat) => stat.signals.includes("never_recalled")).length,
      corrected_after_recall_count: memoryStats.filter((stat) => stat.signals.includes("recalled_then_corrected")).length,
      average_effectiveness: avg,
    },
    memory_stats: memoryStats,
    recommendations,
    mutation_performed: false,
  }) as RecallEffectivenessReport;
}

export function renderRecallEffectivenessReport(report: RecallEffectivenessReport): string {
  return redactSecrets([
    "# PI Recall Effectiveness Report",
    "",
    `Generated: ${report.generated_at}`,
    `Average effectiveness: ${report.summary.average_effectiveness}/100`,
    `Events: ${report.summary.total_events} · Selected memories: ${report.summary.selected_memory_count} · Never recalled: ${report.summary.never_recalled_count} · Corrected after recall: ${report.summary.corrected_after_recall_count}`,
    "",
    "## Memory Recall Signals",
    ...report.memory_stats.slice(0, 20).map((stat) => `- ${stat.memory_id}: ${stat.effectiveness_score}/100 · selected ${stat.selected_count} · excluded ${stat.excluded_count} · corrections ${stat.correction_count} · ${stat.signals.join(", ") || "neutral"}`),
    "",
    "## Recommendations",
    ...(report.recommendations.length ? report.recommendations.map((rec) => `- ${rec.summary}: ${rec.reason}. Review required; No automatic mutation performed.`) : ["- No review recommendations. No automatic mutation performed."]),
  ].join("\n"));
}
