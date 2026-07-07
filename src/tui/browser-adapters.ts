import { createInteractiveBrowser, type BrowserItem, type BrowserOptions, type BrowserResult } from "./InteractiveBrowser";
import type { BackgroundAnalysisJob } from "../background-analysis";
import type { DiagnosticsReport } from "../diagnostics";
import type { TimelineEvent, MemoryTimelineReport } from "../timeline";
import type { MemoryHealthAuditReport, HealthCategoryScore } from "../health-audit";
import type { RecallXrayReport, IncludedMemoryXray, ExcludedMemoryXray } from "../recall-xray";
import type { CaptureCandidate, EvidenceRecord, MemoryRecord } from "../types";

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
