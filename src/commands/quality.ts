import { analyzeRecallEffectiveness, renderRecallEffectivenessReport } from "../recall-effectiveness";
import { buildRecallXray, renderRecallXrayReport } from "../recall-xray";
import { enqueueBackgroundAnalysis, listBackgroundAnalysisJobs, runBackgroundAnalysisQueue, type BackgroundAnalysisKind } from "../background-analysis";
import { exportMemoryGraph, renderMemoryGraphSummary, saveMemoryGraphReport } from "../memory-graph";
import { analyzeMemoryQuality, renderMemoryQualityReport } from "../memory-quality";
import { scoreMemoryWorth } from "../memory-worth";
import { resolveMemoryProfile } from "../profile";
import { InvocationProfiler, renderInvocationProfileReport } from "../profiling";
import { analyzeRelationshipQuality, renderRelationshipQualityReport } from "../relationship-quality";
import { loadActiveRecords } from "../store";
import { analyzeStoreQuality, renderStoreQualityReport } from "../store-quality";
import { buildMemoryTimeline, renderMemoryTimeline, saveMemoryTimelineReport } from "../timeline";
import {
  backgroundBrowserOptions, memoryQualityBrowserOptions, openBrowser, recallEffectivenessBrowserOptions,
  recallXrayBrowserOptions, relationshipQualityBrowserOptions, storeQualityBrowserOptions, timelineBrowserOptions,
} from "../tui/browser-adapters";
import { notifyStructured, parseCommandArgs, wantsPlainOutput } from "./output";
import type { CommandDefinition } from "./types";

type QualityDependencies = {
  getRoot(): string;
  getSessionCwd(): string;
  nowIso(): string;
  rememberCommand(command: string, output: string, summary?: string): void;
};

type QualityCommands = {
  memoryRecallXray: CommandDefinition;
  memoryBackground: CommandDefinition;
  memoryRecallEffectiveness: CommandDefinition;
  memoryStoreQuality: CommandDefinition;
  memoryQuality: CommandDefinition;
  memoryRelationshipQuality: CommandDefinition;
  memoryWorth: CommandDefinition;
  memoryGraph: CommandDefinition;
  memoryTimeline: CommandDefinition;
};

export function createQualityCommands(dependencies: QualityDependencies): QualityCommands {
  return {
    memoryRecallXray: {
      description: "Browse why memory would be included or excluded for a query (read-only). Usage: /memory-recall-xray <query> [--plain|--json]",
      handler: async (args, context) => {
        try {
          const root = dependencies.getRoot();
          const sessionCwd = dependencies.getSessionCwd();
          const parsed = parseCommandArgs(args);
          const query = parsed.positional.join(" ") || args.replace(/--(plain|json|yaml|interactive)\b/g, "").trim();
          const profile = resolveMemoryProfile(root, sessionCwd);
          const profiler = parsed.flags.profile === true ? new InvocationProfiler("recall_xray") : undefined;
          const report = buildRecallXray(root, { query, profile_id: profile.profile_id, resource_id: profile.resource_id, working_directory: sessionCwd, project_root: sessionCwd, profiler });
          const text = [renderRecallXrayReport(report), report.profile ? `\n${renderInvocationProfileReport(report.profile)}` : ""].filter(Boolean).join("\n");
          dependencies.rememberCommand("memory-recall-xray", text, `xray: ${report.summary.included_count} included, ${report.summary.excluded_count} excluded`);
          if (wantsPlainOutput(args) || !context.ui.custom) notifyStructured(context, args, report, text, "info");
          else await openBrowser(context, recallXrayBrowserOptions(report), text);
        } catch (error) {
          context.ui.notify(`Recall x-ray failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    },
    memoryBackground: {
      description: "Queue and run inspectable local background memory analysis. Usage: /memory-background enqueue <kind>|run|list",
      handler: async (args, context) => {
        const parts = args.trim().split(/\s+/).filter(Boolean);
        const action = parts[0] ?? "list";
        try {
          const root = dependencies.getRoot();
          if (action === "enqueue") {
            const kind = (parts[1] ?? "diagnostics") as BackgroundAnalysisKind;
            const profile = resolveMemoryProfile(root, dependencies.getSessionCwd());
            const job = enqueueBackgroundAnalysis(root, { kind, profile_id: profile.profile_id, resource_id: profile.resource_id, input_summary: parts.slice(2).join(" ") || undefined }, dependencies.nowIso());
            context.ui.notify(`Queued background analysis ${job.id} (${job.kind}).`, "success");
            return;
          }
          if (action === "run") {
            const jobs = runBackgroundAnalysisQueue(root, { now: dependencies.nowIso() });
            context.ui.notify(jobs.map((job) => `${job.id} [${job.status}]${job.output_artifact_path ? ` ${job.output_artifact_path}` : ""}${job.error ? ` ${job.error}` : ""}`).join("\n") || "No background jobs.", "info");
            return;
          }
          const jobs = listBackgroundAnalysisJobs(root);
          const plain = jobs.map((job) => `${job.id} [${job.status}] ${job.kind}`).join("\n") || "No background jobs.";
          dependencies.rememberCommand("memory-background", plain, `background: ${jobs.length} jobs`);
          if (wantsPlainOutput(args) || !context.ui.custom) notifyStructured(context, args, jobs, plain, "info");
          else await openBrowser(context, backgroundBrowserOptions(jobs), plain);
        } catch (error) {
          context.ui.notify(`Background analysis failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    },
    memoryRecallEffectiveness: reportCommand(
      "Browse report-only analytics for recalled, excluded, never-recalled, and correction-adjacent memories. Usage: /memory-recall-effectiveness [--plain|--json]",
      dependencies,
      (root, now) => analyzeRecallEffectiveness(root, { now }),
      renderRecallEffectivenessReport,
      (report) => `recall effectiveness: avg ${report.summary.average_effectiveness}/100, ${report.recommendations.length} recommendations`,
      (report) => report.summary.never_recalled_count || report.summary.corrected_after_recall_count ? "warning" : "success",
      recallEffectivenessBrowserOptions,
      "memory-recall-effectiveness",
      "Recall effectiveness analysis",
    ),
    memoryStoreQuality: reportCommand(
      "Browse report-only aggregate store quality across memory, relationships, governance, inbox, and runtime. Usage: /memory-store-quality [--plain|--json]",
      dependencies,
      (root, now) => analyzeStoreQuality(root, { now }), renderStoreQualityReport,
      (report) => `store quality: ${report.overall_score}/100, ${report.recommendations.length} recommendations`,
      (report) => report.overall_score < 85 ? "warning" : "success", storeQualityBrowserOptions,
      "memory-store-quality", "Store quality analysis",
    ),
    memoryQuality: reportCommand(
      "Browse report-only per-memory quality and lifecycle analysis. Usage: /memory-quality [--plain|--json]",
      dependencies,
      (root, now) => analyzeMemoryQuality(root, { now }), renderMemoryQualityReport,
      (report) => `memory quality: avg ${report.summary.average_quality}/100, ${report.recommendations.length} recommendations`,
      (report) => report.summary.low_quality_count ? "warning" : "success", memoryQualityBrowserOptions,
      "memory-quality", "Memory quality analysis",
    ),
    memoryRelationshipQuality: reportCommand(
      "Browse report-only quality analysis for memory graph relationships. Usage: /memory-relationship-quality [--plain|--json]",
      dependencies,
      (root, now) => analyzeRelationshipQuality(root, { now }), renderRelationshipQualityReport,
      (report) => `relationship quality: avg ${report.summary.average_relationship_quality}/100, ${report.recommendations.length} recommendations`,
      (report) => report.summary.weak_edge_count || report.summary.orphan_memory_count ? "warning" : "success", relationshipQualityBrowserOptions,
      "memory-relationship-quality", "Relationship quality analysis",
    ),
    memoryWorth: {
      description: "Score whether an observation is worth durable memory capture (read-only). Usage: /memory-worth <observation>",
      handler: async (args, context) => {
        const decision = scoreMemoryWorth({ observation: args, existingStatements: loadActiveRecords(dependencies.getRoot()).map((record) => record.statement) });
        context.ui.notify(JSON.stringify(decision, null, 2), decision.decision === "reject" ? "warning" : "info");
      },
    },
    memoryGraph: {
      description: "Export governed memory dependency graph (read-only)",
      handler: async (args, context) => {
        try {
          const root = dependencies.getRoot();
          const graph = exportMemoryGraph(root, dependencies.nowIso());
          context.ui.notify(renderMemoryGraphSummary(graph), "info");
          if (args.includes("--save")) context.ui.notify(`Memory graph saved: ${saveMemoryGraphReport(root, graph)}`, "success");
        } catch (error) {
          context.ui.notify(`Memory graph failed: ${error}`, "error");
        }
      },
    },
    memoryTimeline: {
      description: "Show memory timeline report. Usage: /memory-timeline [--memory <id>] [--save]",
      handler: async (args, context) => {
        try {
          const root = dependencies.getRoot();
          const parts = args.trim().split(/\s+/).filter(Boolean);
          const memoryIndex = parts.indexOf("--memory");
          const report = buildMemoryTimeline(root, { memoryId: memoryIndex >= 0 ? parts[memoryIndex + 1] : undefined }, dependencies.nowIso());
          const plain = renderMemoryTimeline(report);
          dependencies.rememberCommand("memory-timeline", plain, `timeline: ${report.events.length} events`);
          if (wantsPlainOutput(args) || !context.ui.custom) notifyStructured(context, args, report, plain, "info");
          else await openBrowser(context, timelineBrowserOptions(report), plain);
          if (parts.includes("--save")) context.ui.notify(`Memory timeline saved: ${saveMemoryTimelineReport(root, report)}`, "success");
        } catch (error) {
          context.ui.notify(`Memory timeline failed: ${error}`, "error");
        }
      },
    },
  };
}

function reportCommand<T>(
  description: string,
  dependencies: QualityDependencies,
  analyze: (root: string, now: string) => T,
  render: (report: T) => string,
  summarize: (report: T) => string,
  kind: (report: T) => string,
  browserOptions: (report: T) => any,
  commandName: string,
  errorLabel: string,
): CommandDefinition {
  return {
    description,
    handler: async (args, context) => {
      try {
        const report = analyze(dependencies.getRoot(), dependencies.nowIso());
        const text = render(report);
        dependencies.rememberCommand(commandName, text, summarize(report));
        if (wantsPlainOutput(args) || !context.ui.custom) notifyStructured(context, args, report, text, kind(report));
        else await openBrowser(context, browserOptions(report), text);
      } catch (error) {
        context.ui.notify(`${errorLabel} failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  };
}
