import { readEvidenceRecords } from "./evidence";
import { redactSecrets, redactSecretsInObject } from "./secret-scanner";
import { loadAllRecords } from "./store";
import type { EvidenceRecord, MemoryRecord } from "./types";

export type MemoryLifecycleState = "active" | "stale" | "dormant" | "contested" | "superseded" | "deleted";

export interface MemoryQualityItem {
  memory_id: string;
  layer: MemoryRecord["layer"];
  status: MemoryRecord["status"];
  lifecycle_state: MemoryLifecycleState;
  quality_score: number;
  confidence: number;
  evidence_count: number;
  live_evidence_count: number;
  age_days: number;
  days_since_update: number;
  signals: string[];
  reasons: string[];
  statement_excerpt: string;
  mutation_performed: false;
}

export interface MemoryQualityRecommendation {
  id: string;
  memory_id: string;
  summary: string;
  reason: string;
  review_required: true;
  mutation_performed: false;
}

export interface MemoryQualityReport {
  generated_at: string;
  summary: {
    total_records: number;
    low_quality_count: number;
    stale_count: number;
    duplicate_signal_count: number;
    contested_count: number;
    superseded_count: number;
    average_quality: number;
  };
  items: MemoryQualityItem[];
  recommendations: MemoryQualityRecommendation[];
  mutation_performed: false;
}

export interface AnalyzeMemoryQualityOptions { now?: string; }

type RecordWithKey = MemoryRecord & { normalized_key?: string };

function daysBetween(start: string | undefined, end: string): number {
  if (!start) return 0;
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(diff) ? Math.max(0, Math.floor(diff / 86_400_000)) : 0;
}

function lifecycleFor(record: MemoryRecord, daysSinceUpdate: number): MemoryLifecycleState {
  if (record.status === "deleted") return "deleted";
  if (record.status === "superseded" || record.superseded_by.length > 0) return "superseded";
  if (record.status === "contested") return "contested";
  if (daysSinceUpdate > 180) return "stale";
  if (daysSinceUpdate > 90) return "dormant";
  return "active";
}

function recommendationFor(item: MemoryQualityItem): MemoryQualityRecommendation | null {
  if (item.quality_score >= 70 && !item.signals.includes("duplicate_normalized_key")) return null;
  const reason = item.reasons.join("; ") || "Quality score indicates review may be useful.";
  return {
    id: `mq_${item.memory_id}`,
    memory_id: item.memory_id,
    summary: `Review memory quality for ${item.memory_id}`,
    reason,
    review_required: true,
    mutation_performed: false,
  };
}

export function analyzeMemoryQualityFromRecords(records: MemoryRecord[], evidence: EvidenceRecord[], now: string): MemoryQualityReport {
  const evidenceById = new Map(evidence.map((ev) => [ev.id, ev]));
  const keyMap = new Map<string, string[]>();
  for (const record of records.filter((r) => r.status === "active")) {
    const key = (record as RecordWithKey).normalized_key;
    if (!key) continue;
    const scoped = `${record.profile_id ?? "legacy"}|${key}`;
    keyMap.set(scoped, [...(keyMap.get(scoped) ?? []), record.id]);
  }
  const duplicateIds = new Set([...keyMap.values()].filter((ids) => ids.length > 1).flat());

  const items = records.map((record): MemoryQualityItem => {
    const refs = [...new Set(record.evidence.map((ev) => ev.ref))];
    const liveEvidence = refs.filter((id) => {
      const ev = evidenceById.get(id);
      return ev && ev.redaction_status !== "deleted" && ev.redaction_status !== "redacted";
    });
    const ageDays = daysBetween(record.created_at, now);
    const daysSinceUpdate = daysBetween(record.updated_at, now);
    const lifecycle = lifecycleFor(record, daysSinceUpdate);
    const signals: string[] = [];
    const reasons: string[] = [];
    let score = 100;

    if (record.confidence < 0.65) { score -= 25; signals.push("low_confidence"); reasons.push(`confidence ${record.confidence.toFixed(2)} is below 0.65`); }
    else if (record.confidence < 0.8) { score -= 10; signals.push("medium_confidence"); reasons.push(`confidence ${record.confidence.toFixed(2)} is below 0.80`); }
    if (refs.length === 0) { score -= 25; signals.push("missing_evidence"); reasons.push("memory has no evidence references"); }
    else if (liveEvidence.length === 0) { score -= 20; signals.push("no_live_evidence"); reasons.push("all structured evidence is missing, redacted, or deleted"); }
    if (lifecycle === "stale") { score -= 20; signals.push("stale"); reasons.push(`updated ${daysSinceUpdate} days ago`); }
    else if (lifecycle === "dormant") { score -= 8; signals.push("dormant"); reasons.push(`updated ${daysSinceUpdate} days ago`); }
    if (duplicateIds.has(record.id)) { score -= 15; signals.push("duplicate_normalized_key"); reasons.push("shares normalized key with another active memory"); }
    if (record.status === "contested") { score -= 25; signals.push("contested"); reasons.push("memory is contested and should not be treated as settled truth"); }
    if (record.status === "superseded" || record.superseded_by.length > 0) { score -= 30; signals.push("superseded"); reasons.push("memory has been superseded and should be reviewed only as history"); }
    if (record.status === "deleted") { score = 0; signals.push("deleted"); reasons.push("memory is deleted"); }

    return {
      memory_id: record.id,
      layer: record.layer,
      status: record.status,
      lifecycle_state: lifecycle,
      quality_score: Math.max(0, Math.min(100, Math.round(score))),
      confidence: record.confidence,
      evidence_count: refs.length,
      live_evidence_count: liveEvidence.length,
      age_days: ageDays,
      days_since_update: daysSinceUpdate,
      signals,
      reasons: reasons.length ? reasons : ["memory has adequate confidence, evidence, and lifecycle freshness"],
      statement_excerpt: redactSecrets(record.statement.slice(0, 180)),
      mutation_performed: false,
    };
  }).sort((a, b) => a.quality_score - b.quality_score || a.memory_id.localeCompare(b.memory_id));

  const recommendations = items.flatMap((item) => recommendationFor(item) ? [recommendationFor(item)!] : []);
  const average = items.length ? Math.round(items.reduce((sum, item) => sum + item.quality_score, 0) / items.length) : 100;
  return redactSecretsInObject({
    generated_at: now,
    summary: {
      total_records: records.length,
      low_quality_count: items.filter((item) => item.quality_score < 70).length,
      stale_count: items.filter((item) => item.lifecycle_state === "stale").length,
      duplicate_signal_count: items.filter((item) => item.signals.includes("duplicate_normalized_key")).length,
      contested_count: items.filter((item) => item.lifecycle_state === "contested").length,
      superseded_count: items.filter((item) => item.lifecycle_state === "superseded").length,
      average_quality: average,
    },
    items,
    recommendations,
    mutation_performed: false,
  }) as MemoryQualityReport;
}

export function analyzeMemoryQuality(root: string, options: AnalyzeMemoryQualityOptions = {}): MemoryQualityReport {
  const now = options.now ?? new Date().toISOString();
  return analyzeMemoryQualityFromRecords(loadAllRecords(root), readEvidenceRecords(root), now);
}

export function renderMemoryQualityReport(report: MemoryQualityReport): string {
  const lines = [
    "# PI Memory Quality Report",
    "",
    `Generated: ${report.generated_at}`,
    `Average quality: ${report.summary.average_quality}/100`,
    `Records: ${report.summary.total_records} · Low quality: ${report.summary.low_quality_count} · Stale: ${report.summary.stale_count} · Duplicate signals: ${report.summary.duplicate_signal_count}`,
    "",
    "## Lowest Quality Memories",
    ...report.items.slice(0, 20).map((item) => `- ${item.memory_id}: ${item.quality_score}/100 [${item.lifecycle_state}] ${item.signals.join(", ") || "healthy"} — ${item.statement_excerpt}`),
    "",
    "## Recommendations",
    ...(report.recommendations.length ? report.recommendations.map((rec) => `- ${rec.summary}: ${rec.reason}. Review required; No automatic mutation performed.`) : ["- No review recommendations. No automatic mutation performed."]),
  ];
  return redactSecrets(lines.join("\n"));
}
