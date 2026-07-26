import { createInteractiveBrowser, type BrowserItem, type BrowserOptions, type BrowserResult } from "./InteractiveBrowser";
import type { BackgroundAnalysisJob } from "../background-analysis";
import type { DiagnosticsReport } from "../diagnostics";
import type { TimelineEvent, MemoryTimelineReport } from "../timeline";
import type { MemoryHealthAuditReport, HealthCategoryScore } from "../health-audit";
import type { MemoryQualityItem, MemoryQualityReport } from "../memory-quality";
import type { RelationshipQualityEdgeItem, RelationshipQualityReport } from "../relationship-quality";
import type { StoreQualityMetric, StoreQualityReport } from "../store-quality";
import type { RecallEffectivenessReport, RecallMemoryStat } from "../recall-effectiveness";
import type { CaptureQualityReport } from "../capture-quality";
import type { RecallXrayReport, IncludedMemoryXray, ExcludedMemoryXray } from "../recall-xray";
import type { CaptureCandidate, EvidenceRecord, InquiryRecord, MemoryRecord } from "../types";

export function memoryRecordBrowserOptions(records: MemoryRecord[]): BrowserOptions<MemoryRecord> {
  const items: BrowserItem<MemoryRecord>[] = records.map((record) => ({
    id: record.id,
    item: record,
    status: record.status === "active" ? "healthy" : record.status === "contested" ? "warning" : "info",
    searchText: `${record.id} ${record.layer} ${record.status} ${record.tags.join(" ")} ${record.ruleType ?? ""} ${record.statement}`,
    details: [
      `Statement: ${record.statement}`,
      `Evidence: ${record.evidence.map((e) => `${e.type}:${e.ref}`).join(", ") || "none"}`,
      `Review: ${record.review.next_review} · ${record.review.change_condition}`,
      `Scope: ${record.scope.type}${record.scope.project ? `:${record.scope.project}` : ""}`,
      `Supersedes: ${record.supersedes.join(", ") || "none"}`,
      `Superseded by: ${record.superseded_by.join(", ") || "none"}`,
      `Vault: ${record.vault_ref ?? "none"}`,
    ],
  }));
  return {
    title: "Long-Term Memory Browser",
    subtitle: "Read-only browser. Use curate/patch commands for governed mutation.",
    items,
    pageSize: 20,
    sortBy: "confidence",
    columns: [
      { key: "id", label: "ID", width: 18, minWidth: 10, priority: 1, render: (r) => r.id, sortValue: (r) => r.id },
      { key: "layer", label: "Layer", width: 6, minWidth: 5, priority: 2, render: (r) => r.layer },
      { key: "kind", label: "Type", width: 10, minWidth: 6, priority: 4, render: (r) => r.ruleType ?? r.memory_kind ?? "—" },
      { key: "confidence", label: "Conf", width: 6, minWidth: 5, priority: 3, render: (r) => r.confidence.toFixed(2), sortValue: (r) => r.confidence },
      { key: "status", label: "Status", width: 10, minWidth: 6, priority: 5, render: (r) => r.status },
      { key: "statement", label: "Statement", minWidth: 18, priority: 1, render: (r) => r.statement },
    ],
    actions: [{ key: "d", label: "deprecate", action: "deprecate" }],
  };
}

export function candidateBrowserOptions(candidates: CaptureCandidate[]): BrowserOptions<CaptureCandidate> {
  return {
    title: "Memory Inbox Browser",
    subtitle: "Inspect candidates. Approval/rejection still flows through governed patch review.",
    items: candidates.map((c) => ({
      id: c.id,
      item: c,
      status: c.status === "new" ? ((c.confidence ?? 0) >= 0.85 ? "healthy" : "warning") : "info",
      searchText: `${c.id} ${c.status} ${c.ruleType ?? ""} ${c.memory_kind ?? ""} ${c.tags.join(" ")} ${c.text}`,
      details: [
        `Text: ${c.text}`,
        `Source: ${c.source.type}:${c.source.ref}${c.source.cwd ? ` (${c.source.cwd})` : ""}`,
        `Evidence refs: ${c.evidence_refs.join(", ") || "none"}`,
        `Evidence IDs: ${(c.evidence_ids ?? []).join(", ") || "none"}`,
        `Trust: ${c.primary_trust_class ?? "unknown"} · promotion ${c.promotion_eligibility ?? "unknown"}`,
        `Match: ${c.match_kind ?? "new"} ${(c.matched_memory_ids ?? []).join(", ")}`,
        `Worth: ${c.worth_decision ?? "unknown"} ${(c.worth_reasons ?? []).join("; ")}`,
      ],
    })),
    pageSize: 20,
    sortBy: "confidence",
    columns: [
      { key: "id", label: "ID", width: 18, minWidth: 10, priority: 1, render: (c) => c.id, sortValue: (c) => c.id },
      { key: "type", label: "Type", width: 10, minWidth: 6, priority: 4, render: (c) => c.ruleType ?? c.memory_kind ?? "—" },
      { key: "confidence", label: "Conf", width: 6, minWidth: 5, priority: 2, render: (c) => (c.confidence ?? 0).toFixed(2), sortValue: (c) => c.confidence ?? 0 },
      { key: "status", label: "Status", width: 9, minWidth: 6, priority: 3, render: (c) => c.status },
      { key: "source", label: "Source", width: 14, minWidth: 8, priority: 5, render: (c) => c.source.type },
      { key: "text", label: "Candidate", minWidth: 20, priority: 1, render: (c) => c.text },
    ],
    actions: [
      { key: "a", label: "approve eligible", action: "approve" },
      { key: "r", label: "review patch", action: "review" },
      { key: "s", label: "skip", action: "skip" },
    ],
  };
}

export function inquiryBrowserOptions(inquiries: InquiryRecord[]): BrowserOptions<InquiryRecord> {
  return {
    title: "Inquiry Review",
    subtitle: "Use /memory-inquiries answer, withdraw, or stale for explicit transitions.",
    items: inquiries.map((inquiry) => ({
      id: inquiry.id,
      item: inquiry,
      status: inquiry.status === "open" ? "warning" : "info",
      searchText: `${inquiry.id} ${inquiry.status} ${inquiry.priority} ${inquiry.tags.join(" ")} ${inquiry.question}`,
      details: [`Question: ${inquiry.question}`, `Context: ${inquiry.context}`, `Status: ${inquiry.status}`, `Related memories: ${inquiry.related_memory_ids?.join(", ") || "none"}`],
    })),
    pageSize: 20,
    columns: [
      { key: "id", label: "ID", width: 18, minWidth: 10, priority: 1, render: (item) => item.id },
      { key: "status", label: "Status", width: 12, minWidth: 8, priority: 2, render: (item) => item.status },
      { key: "priority", label: "Priority", width: 10, minWidth: 8, priority: 3, render: (item) => item.priority },
      { key: "question", label: "Question", minWidth: 24, priority: 1, render: (item) => item.question },
    ],
  };
}

export function evidenceBrowserOptions(evidence: EvidenceRecord[]): BrowserOptions<EvidenceRecord> {
  return {
    title: "Evidence Browser",
    subtitle: "Read-only evidence/provenance inspection.",
    items: evidence.map((ev) => ({ id: ev.id, item: ev, status: ev.redaction_status === "deleted" || ev.redaction_status === "redacted" ? "warning" : "healthy", searchText: `${ev.id} ${ev.source_kind} ${ev.trust_class} ${ev.polarity} ${ev.tags?.join(" ") ?? ""} ${ev.source_summary} ${ev.source_excerpt ?? ""}`, details: [`Summary: ${ev.source_summary}`, `Excerpt: ${ev.source_excerpt ?? "none"}`, `Related memories: ${ev.related_memory_ids.join(", ") || "none"}`, `Source: ${ev.source_file ?? ev.source_ref ?? ev.source_tool ?? "none"}`, `Redaction: ${ev.redaction_status ?? "none"}`] })),
    pageSize: 20,
    columns: [
      { key: "id", label: "ID", width: 18, minWidth: 10, priority: 1, render: (e) => e.id },
      { key: "kind", label: "Kind", width: 16, minWidth: 8, priority: 2, render: (e) => e.source_kind },
      { key: "trust", label: "Trust", width: 20, minWidth: 8, priority: 4, render: (e) => e.trust_class },
      { key: "polarity", label: "Pol", width: 10, minWidth: 6, priority: 3, render: (e) => e.polarity },
      { key: "summary", label: "Summary", minWidth: 20, priority: 1, render: (e) => e.source_summary },
    ],
  };
}

type DiagnosticsRow = { section: string; status: string; count: number; detail: string };
export function diagnosticsBrowserOptions(report: DiagnosticsReport): BrowserOptions<DiagnosticsRow> {
  const rows: DiagnosticsRow[] = [
    { section: "Runtime", status: "info", count: 0, detail: `Root: ${report.root}\nGenerated: ${report.timestamp}` },
    { section: "Memory", status: report.summary.errors ? "error" : report.summary.warnings ? "warning" : "healthy", count: report.findings.length, detail: report.findings.map((f) => `[${f.severity}] ${f.code}: ${f.message}`).join("\n") || "No diagnostics findings." },
    { section: "Performance", status: "info", count: 0, detail: "Use /memory-recall-xray and injection stats for retrieval timing; diagnostics stay read-only." },
    { section: "Governance", status: report.summary.errors ? "error" : "healthy", count: report.summary.errors, detail: `Errors: ${report.summary.errors}\nWarnings: ${report.summary.warnings}\nInfo: ${report.summary.info}` },
    { section: "Privacy", status: report.findings.some((f) => f.code.includes("privacy") || f.code.includes("secret")) ? "warning" : "healthy", count: report.findings.filter((f) => f.code.includes("privacy") || f.code.includes("secret")).length, detail: "Privacy/tombstone findings are included in Memory section." },
    { section: "FTS", status: "info", count: 0, detail: "FTS health is covered by post-mutation checks and runtime events." },
  ];
  return {
    title: "Memory Doctor Dashboard",
    subtitle: `Health: ${report.summary.errors === 0 && report.summary.warnings === 0 ? "healthy" : "attention required"}`,
    items: rows.map((row) => ({ id: row.section, item: row, status: row.status as any, searchText: `${row.section} ${row.status} ${row.detail}`, details: row.detail.split(/\n/g) })),
    pageSize: 12,
    columns: [
      { key: "section", label: "Section", width: 18, minWidth: 10, priority: 1, render: (r) => r.section },
      { key: "status", label: "Status", width: 10, minWidth: 7, priority: 2, render: (r) => r.status },
      { key: "count", label: "Count", width: 7, minWidth: 5, priority: 3, render: (r) => String(r.count), sortValue: (r) => r.count },
      { key: "detail", label: "Summary", minWidth: 20, priority: 1, render: (r) => r.detail.split(/\n/g)[0] ?? "" },
    ],
  };
}

type XrayRow = ({ kind: "included" } & IncludedMemoryXray) | ({ kind: "excluded" } & ExcludedMemoryXray);
export function recallXrayBrowserOptions(report: RecallXrayReport): BrowserOptions<XrayRow> {
  const rows: XrayRow[] = [...report.included.map((m) => ({ kind: "included" as const, ...m })), ...report.excluded.map((m) => ({ kind: "excluded" as const, ...m }))];
  return {
    title: "Recall X-Ray Explorer",
    subtitle: `${report.summary.included_count} included · ${report.summary.excluded_count} excluded · budget ${report.summary.context_budget.selected_chars}/${report.summary.context_budget.raw_candidate_chars} chars`,
    items: rows.map((row) => ({
      id: row.memory_id,
      item: row,
      status: row.kind === "included" ? "healthy" : row.tombstoned || row.deleted || row.superseded ? "info" : row.contested ? "warning" : "info",
      searchText: `${row.kind} ${row.memory_id} ${"retrieval_tier" in row ? row.retrieval_tier : ""} ${"included_reason" in row ? row.included_reason : row.excluded_reason} ${"statement_excerpt" in row ? row.statement_excerpt ?? "" : ""}`,
      details: row.kind === "included" ? [
        `Reason: ${row.included_reason}`,
        `Score: ${row.retrieval_score ?? "n/a"} · tier ${row.retrieval_tier}`,
        `Score provenance: ${JSON.stringify(row.score_provenance ?? {})}`,
        `Evidence: ${(row.evidence_ids ?? []).join(", ") || "none"}`,
        `Evidence sources: ${(row.evidence_source_kinds ?? []).join(", ") || "unknown"}`,
        `Warnings: ${(row.warnings ?? []).join("; ") || "none"}`,
        `Excerpt: ${row.statement_excerpt ?? ""}`,
      ] : [
        `Excluded: ${row.excluded_reason}`,
        `Filtered by: ${row.filtered_by.join(", ")}`,
        `Scope mismatch: ${Boolean(row.scope_mismatch)}`,
        `Negative scope: ${Boolean(row.negative_scope_match)}`,
        `Superseded/deleted/tombstoned: ${Boolean(row.superseded || row.deleted || row.tombstoned)}`,
      ],
    })),
    pageSize: 20,
    columns: [
      { key: "id", label: "Memory", width: 20, minWidth: 10, priority: 1, render: (r) => r.memory_id },
      { key: "kind", label: "Kind", width: 9, minWidth: 7, priority: 2, render: (r) => r.kind },
      { key: "tier", label: "Tier/Reason", width: 18, minWidth: 8, priority: 3, render: (r) => r.kind === "included" ? r.retrieval_tier : r.excluded_reason },
      { key: "score", label: "Score", width: 7, minWidth: 5, priority: 4, render: (r) => r.kind === "included" ? String(r.retrieval_score ?? "") : "—", sortValue: (r) => r.kind === "included" ? r.retrieval_score ?? 0 : -1 },
      { key: "detail", label: "Detail", minWidth: 20, priority: 1, render: (r) => r.kind === "included" ? r.included_reason : r.excluded_reason },
    ],
  };
}

export function backgroundBrowserOptions(jobs: BackgroundAnalysisJob[]): BrowserOptions<BackgroundAnalysisJob> {
  return {
    title: "Background Activity Panel",
    subtitle: "Read-only queue/running/completed/recovered/failed activity.",
    items: jobs.map((job) => ({ id: job.id, item: job, status: job.status === "succeeded" ? "healthy" : job.status === "failed" ? "error" : job.status === "running" ? "warning" : "info", searchText: `${job.id} ${job.kind} ${job.status} ${job.error ?? ""} ${job.output_artifact_path ?? ""}`, details: [`Kind: ${job.kind}`, `Status: ${job.status}`, `Created: ${job.created_at}`, `Started: ${job.started_at ?? "not started"}`, `Finished: ${(job as { finished_at?: string }).finished_at ?? "not finished"}`, `Artifact: ${job.output_artifact_path ?? "none"}`, `Warnings: ${(job.warnings ?? []).join("; ") || "none"}`, `Error: ${job.error ?? "none"}`] })),
    pageSize: 20,
    columns: [
      { key: "id", label: "ID", width: 22, minWidth: 10, priority: 1, render: (j) => j.id },
      { key: "kind", label: "Kind", width: 22, minWidth: 10, priority: 2, render: (j) => j.kind },
      { key: "status", label: "Status", width: 12, minWidth: 8, priority: 3, render: (j) => j.status },
      { key: "created", label: "Created", width: 18, minWidth: 10, priority: 4, render: (j) => j.created_at, sortValue: (j) => j.created_at },
      { key: "artifact", label: "Artifact", minWidth: 20, priority: 1, render: (j) => j.output_artifact_path ?? j.error ?? "" },
    ],
  };
}

export function timelineBrowserOptions(report: MemoryTimelineReport): BrowserOptions<TimelineEvent> {
  return {
    title: "Memory Timeline Browser",
    subtitle: `${report.events.length} lifecycle event(s)` ,
    items: report.events.map((event) => ({ id: event.id, item: event, status: event.type === "tombstone" ? "warning" : event.type === "supersession" ? "info" : "healthy", searchText: `${event.id} ${event.type} ${event.memory_id ?? ""} ${event.summary}`, details: [`Timestamp: ${event.timestamp}`, `Type: ${event.type}`, `Memory: ${event.memory_id ?? "none"}`, `Summary: ${event.summary}`] })),
    pageSize: 20,
    sortBy: "timestamp",
    columns: [
      { key: "time", label: "Time", width: 20, minWidth: 10, priority: 1, render: (e) => e.timestamp, sortValue: (e) => e.timestamp },
      { key: "type", label: "Type", width: 14, minWidth: 8, priority: 2, render: (e) => e.type },
      { key: "memory", label: "Memory", width: 20, minWidth: 10, priority: 3, render: (e) => e.memory_id ?? "—" },
      { key: "summary", label: "Summary", minWidth: 20, priority: 1, render: (e) => e.summary },
    ],
  };
}

export function memoryQualityBrowserOptions(report: MemoryQualityReport): BrowserOptions<MemoryQualityItem> {
  const recommendationsByMemory = new Map(report.items.map((item) => [item.memory_id, report.recommendations.filter((rec) => rec.memory_id === item.memory_id)]));
  return {
    title: "Memory Quality Browser",
    subtitle: `Average ${report.summary.average_quality}/100 · ${report.summary.low_quality_count} low-quality · ${report.summary.stale_count} stale · report-only`,
    items: report.items.map((item) => {
      const recommendations = recommendationsByMemory.get(item.memory_id) ?? [];
      return {
        id: item.memory_id,
        item,
        status: item.quality_score < 50 ? "error" : item.quality_score < 70 ? "warning" : "healthy",
        searchText: `${item.memory_id} ${item.lifecycle_state} ${item.status} ${item.signals.join(" ")} ${item.reasons.join(" ")} ${item.statement_excerpt}`,
        details: [
          `Score: ${item.quality_score}/100 · lifecycle ${item.lifecycle_state} · status ${item.status}`,
          `Evidence: ${item.live_evidence_count}/${item.evidence_count} live · confidence ${item.confidence.toFixed(2)}`,
          `Age: ${item.age_days} days · updated ${item.days_since_update} days ago`,
          `Signals: ${item.signals.join(", ") || "healthy"}`,
          ...item.reasons.map((reason) => `Reason: ${reason}`),
          ...(recommendations.length ? recommendations.map((rec) => `Recommendation: ${rec.summary} — ${rec.reason}. Review required; No automatic mutation performed.`) : ["No recommendations for this memory. No automatic mutation performed."]),
          `Excerpt: ${item.statement_excerpt}`,
        ],
      } satisfies BrowserItem<MemoryQualityItem>;
    }),
    pageSize: 20,
    sortBy: "score",
    columns: [
      { key: "id", label: "Memory", width: 20, minWidth: 10, priority: 1, render: (item) => item.memory_id },
      { key: "score", label: "Score", width: 7, minWidth: 5, priority: 2, render: (item) => String(item.quality_score), sortValue: (item) => item.quality_score },
      { key: "lifecycle", label: "Lifecycle", width: 12, minWidth: 8, priority: 3, render: (item) => item.lifecycle_state },
      { key: "confidence", label: "Conf", width: 6, minWidth: 5, priority: 4, render: (item) => item.confidence.toFixed(2), sortValue: (item) => item.confidence },
      { key: "signals", label: "Signals", width: 24, minWidth: 10, priority: 5, render: (item) => item.signals.join(",") || "healthy" },
      { key: "statement", label: "Statement", minWidth: 20, priority: 1, render: (item) => item.statement_excerpt },
    ],
  };
}

export function relationshipQualityBrowserOptions(report: RelationshipQualityReport): BrowserOptions<RelationshipQualityEdgeItem> {
  return {
    title: "Relationship Quality Browser",
    subtitle: `Average ${report.summary.average_relationship_quality}/100 · ${report.summary.weak_edge_count} weak · ${report.summary.orphan_memory_count} orphans · report-only`,
    items: report.relationships.map((edge) => ({
      id: edge.edge_id,
      item: edge,
      status: edge.quality_band === "broken" ? "error" : edge.quality_band === "weak" ? "warning" : "healthy",
      searchText: `${edge.edge_id} ${edge.type} ${edge.from} ${edge.to} ${edge.quality_band} ${edge.signals.join(" ")} ${edge.reasons.join(" ")}`,
      details: [
        `Score: ${edge.quality_score}/100 · ${edge.quality_band}`,
        `Type: ${edge.type}`,
        `From: ${edge.from}`,
        `To: ${edge.to}`,
        `Signals: ${edge.signals.join(", ") || "healthy"}`,
        ...edge.reasons.map((reason) => `Reason: ${reason}`),
        "No automatic mutation performed.",
      ],
    })),
    pageSize: 20,
    sortBy: "score",
    columns: [
      { key: "id", label: "Relationship", width: 28, minWidth: 12, priority: 1, render: (edge) => edge.edge_id },
      { key: "score", label: "Score", width: 7, minWidth: 5, priority: 2, render: (edge) => String(edge.quality_score), sortValue: (edge) => edge.quality_score },
      { key: "band", label: "Band", width: 8, minWidth: 6, priority: 3, render: (edge) => edge.quality_band },
      { key: "type", label: "Type", width: 16, minWidth: 8, priority: 4, render: (edge) => edge.type },
      { key: "signals", label: "Signals", minWidth: 20, priority: 1, render: (edge) => edge.signals.join(",") || "healthy" },
    ],
  };
}

export function recallEffectivenessBrowserOptions(report: RecallEffectivenessReport): BrowserOptions<RecallMemoryStat> {
  const recommendationsByMemory = new Map(report.memory_stats.map((stat) => [stat.memory_id, report.recommendations.filter((rec) => rec.memory_id === stat.memory_id)]));
  return {
    title: "Recall Effectiveness Browser",
    subtitle: `Average ${report.summary.average_effectiveness}/100 · ${report.summary.total_events} events · ${report.summary.never_recalled_count} never recalled · report-only`,
    items: report.memory_stats.map((stat) => {
      const recommendations = recommendationsByMemory.get(stat.memory_id) ?? [];
      return {
        id: stat.memory_id,
        item: stat,
        status: stat.effectiveness_score < 50 ? "error" : stat.effectiveness_score < 70 ? "warning" : "healthy",
        searchText: `${stat.memory_id} ${stat.status} ${stat.layer} ${stat.signals.join(" ")} selected ${stat.selected_count} excluded ${stat.excluded_count}`,
        details: [
          `Score: ${stat.effectiveness_score}/100 · selected ${stat.selected_count} · excluded ${stat.excluded_count} · corrections ${stat.correction_count}`,
          `Last recalled: ${stat.last_recalled_at ?? "never"}`,
          `Signals: ${stat.signals.join(", ") || "neutral"}`,
          ...(recommendations.length ? recommendations.map((rec) => `Recommendation: ${rec.summary} — ${rec.reason} Review required; No automatic mutation performed.`) : ["No recommendations for this memory. No automatic mutation performed."]),
        ],
      } satisfies BrowserItem<RecallMemoryStat>;
    }),
    pageSize: 20,
    sortBy: "score",
    columns: [
      { key: "memory", label: "Memory", width: 20, minWidth: 10, priority: 1, render: (stat) => stat.memory_id },
      { key: "score", label: "Score", width: 7, minWidth: 5, priority: 2, render: (stat) => String(stat.effectiveness_score), sortValue: (stat) => stat.effectiveness_score },
      { key: "selected", label: "Selected", width: 9, minWidth: 5, priority: 3, render: (stat) => String(stat.selected_count), sortValue: (stat) => stat.selected_count },
      { key: "excluded", label: "Excluded", width: 9, minWidth: 5, priority: 4, render: (stat) => String(stat.excluded_count), sortValue: (stat) => stat.excluded_count },
      { key: "signals", label: "Signals", minWidth: 20, priority: 1, render: (stat) => stat.signals.join(",") || "neutral" },
    ],
  };
}

interface CaptureQualityMetric {
  id: string;
  label: string;
  count: number;
  detail: string;
}

export function captureQualityBrowserOptions(report: CaptureQualityReport): BrowserOptions<CaptureQualityMetric> {
  const items: CaptureQualityMetric[] = [
    { id: "messages", label: "Messages evaluated", count: report.messages_evaluated, detail: "Bounded capture events evaluated" },
    { id: "created", label: "Candidates created", count: report.funnel.candidate_created, detail: "New governed capture candidates" },
    { id: "reinforced", label: "Candidates reinforced", count: report.funnel.candidate_reinforced, detail: "Equivalent preferences linked as recurrence" },
    { id: "rejected", label: "Rejected", count: report.funnel.rejected, detail: Object.entries(report.rejection_reasons).map(([reason, count]) => `${reason}: ${count}`).join(", ") || "No rejection reasons" },
    { id: "pending", label: "Pending candidates", count: report.pending_candidates, detail: `${report.repeated_pending_preferences} repeated pending preferences` },
    { id: "global", label: "Active global preferences", count: report.active_global_preferences, detail: `Scopes: ${Object.entries(report.scope_distribution).map(([scope, count]) => `${scope}: ${count}`).join(", ") || "none"}` },
    { id: "project", label: "Active project conventions", count: report.active_project_conventions, detail: "Project-scoped active conventions" },
    { id: "bytes", label: "Runtime capture bytes", count: report.runtime_bytes, detail: "Activity, checkpoint, and event storage" },
  ];
  return {
    title: "Capture Quality Dashboard",
    subtitle: `${report.messages_evaluated} evaluated · ${report.pending_candidates} pending · report-only`,
    items: items.map((metric) => ({ id: metric.id, item: metric, status: metric.id === "rejected" && metric.count > report.funnel.candidate_created ? "warning" : "info", searchText: `${metric.label} ${metric.detail}`, details: [`Count: ${metric.count}`, metric.detail, "No automatic mutation performed."] })),
    pageSize: 10,
    sortBy: "count",
    columns: [
      { key: "metric", label: "Metric", width: 28, minWidth: 16, priority: 1, render: (metric) => metric.label },
      { key: "count", label: "Count", width: 10, minWidth: 7, priority: 2, render: (metric) => String(metric.count), sortValue: (metric) => metric.count },
      { key: "detail", label: "Detail", minWidth: 24, priority: 1, render: (metric) => metric.detail },
    ],
  };
}

export function storeQualityBrowserOptions(report: StoreQualityReport): BrowserOptions<StoreQualityMetric> {
  const recommendationsByMetric = new Map(report.metrics.map((metric) => [metric.id, report.recommendations.filter((rec) => rec.metric_id === metric.id)]));
  return {
    title: "Store Quality Dashboard",
    subtitle: `Overall ${report.overall_score}/100 [${report.status}] · ${report.inputs.active_memories} active memories · report-only`,
    items: report.metrics.map((metric) => {
      const recommendations = recommendationsByMetric.get(metric.id) ?? [];
      return {
        id: metric.id,
        item: metric,
        status: metric.status === "attention" ? "error" : metric.status === "watch" ? "warning" : "healthy",
        searchText: `${metric.label} ${metric.score} ${metric.status} ${metric.signals.join(" ")} ${metric.summary}`,
        details: [
          `Score: ${metric.score}/100 · ${metric.status}`,
          `Summary: ${metric.summary}`,
          `Signals: ${metric.signals.join(", ") || "healthy"}`,
          ...(recommendations.length ? recommendations.map((rec) => `Recommendation: ${rec.summary} — ${rec.reason} Review required; No automatic mutation performed.`) : ["No recommendations for this metric. No automatic mutation performed."]),
        ],
      } satisfies BrowserItem<StoreQualityMetric>;
    }),
    pageSize: 10,
    sortBy: "score",
    columns: [
      { key: "metric", label: "Metric", width: 22, minWidth: 10, priority: 1, render: (metric) => metric.label },
      { key: "score", label: "Score", width: 7, minWidth: 5, priority: 2, render: (metric) => String(metric.score), sortValue: (metric) => metric.score },
      { key: "status", label: "Status", width: 10, minWidth: 7, priority: 3, render: (metric) => metric.status },
      { key: "signals", label: "Signals", minWidth: 20, priority: 1, render: (metric) => metric.signals.join(",") || "healthy" },
    ],
  };
}

export function healthAuditBrowserOptions(report: MemoryHealthAuditReport): BrowserOptions<HealthCategoryScore> {
  const findingsByCategory = new Map(report.categories.map((category) => [category.id, report.findings.filter((finding) => finding.category === category.id)]));
  const recommendationsByCategory = new Map(report.categories.map((category) => [category.id, report.recommendations.filter((rec) => rec.category === category.id)]));
  const trendLine = report.trend ? `Trend vs ${report.trend.previous_timestamp}: overall ${report.trend.overall_delta >= 0 ? "+" : ""}${report.trend.overall_delta}; duplicates ${report.trend.duplicates_delta >= 0 ? "+" : ""}${report.trend.duplicates_delta}; inbox ${report.trend.inbox_delta >= 0 ? "+" : ""}${report.trend.inbox_delta}; runtime warnings ${report.trend.runtime_warnings_delta >= 0 ? "+" : ""}${report.trend.runtime_warnings_delta}.` : "Trend: first snapshot.";
  return {
    title: "Memory Health Audit",
    subtitle: `Health ${report.health_score.overall}/100 · ${report.generated_at} · report-only`,
    items: report.categories.map((category) => {
      const findings = findingsByCategory.get(category.id) ?? [];
      const recommendations = recommendationsByCategory.get(category.id) ?? [];
      return {
        id: category.id,
        item: category,
        status: category.errors > 0 ? "error" : category.warnings > 0 ? "warning" : "healthy",
        searchText: `${category.label} ${category.score} ${findings.map((f) => `${f.code} ${f.reason}`).join(" ")} ${recommendations.map((r) => r.summary).join(" ")}`,
        details: [
          `Score: ${category.score}/100 (${category.errors} errors, ${category.warnings} warnings)`,
          trendLine,
          `Snapshot: ${report.snapshot.active_memories} active memories · ${report.snapshot.candidate_count} new candidates · ${report.snapshot.duplicates} duplicate signals · ${report.snapshot.conflicts} conflicts`,
          ...(findings.length ? findings.map((finding) => `${finding.severity.toUpperCase()} ${finding.code}: ${finding.reason} Affected: ${finding.affected_ids.join(", ") || "none"}. No automatic mutation performed.`) : ["No findings for this category. No automatic mutation performed."]),
          ...(recommendations.length ? recommendations.map((rec) => `Recommendation: ${rec.summary} — ${rec.reason} Review required; no automatic mutation performed.`) : ["No recommendations for this category."]),
        ],
      } satisfies BrowserItem<HealthCategoryScore>;
    }),
    pageSize: 10,
    sortBy: "score",
    columns: [
      { key: "category", label: "Category", width: 18, minWidth: 10, priority: 1, render: (c) => c.label },
      { key: "score", label: "Score", width: 7, minWidth: 5, priority: 2, render: (c) => String(c.score), sortValue: (c) => c.score },
      { key: "errors", label: "Err", width: 5, minWidth: 4, priority: 3, render: (c) => String(c.errors), sortValue: (c) => c.errors },
      { key: "warnings", label: "Warn", width: 6, minWidth: 4, priority: 4, render: (c) => String(c.warnings), sortValue: (c) => c.warnings },
      { key: "findings", label: "Summary", minWidth: 20, priority: 1, render: (c) => `${c.findings} finding(s)` },
    ],
  };
}

export function openBrowser<T>(ctx: { ui: { custom?: Function; notify(message: string, kind?: string): void } }, opts: BrowserOptions<T>, fallback: string): Promise<BrowserResult<T> | null> {
  if (!ctx.ui.custom) { ctx.ui.notify(fallback, "info"); return Promise.resolve(null); }
  return ctx.ui.custom((tui: unknown, theme: unknown, _kb: unknown, done: (result: BrowserResult<T> | null) => void) => createInteractiveBrowser(opts, done, tui as { requestRender(): void }, theme));
}
