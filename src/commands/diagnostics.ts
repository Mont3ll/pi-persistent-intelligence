import { loadConfig } from "../config";
import { runMemoryDiagnostics, renderDiagnosticsReport, saveDiagnosticsReport } from "../diagnostics";
import { renderHealthAuditReport, runMemoryHealthAudit, saveHealthAuditReport } from "../health-audit";
import { listCandidates } from "../inbox";
import { ensureMemoryDirs } from "../paths";
import { renderInvocationProfileReport } from "../profiling";
import { diagnosticsBrowserOptions, healthAuditBrowserOptions, openBrowser } from "../tui/browser-adapters";
import { notifyStructured, parseCommandArgs, wantsPlainOutput } from "./output";
import type { CommandDefinition } from "./types";

type ConsolidationModel = { model: string | null; source: "env" | "current" | "pi-default" };

type DiagnosticDependencies = {
  getRoot(): string;
  getSessionCount(): number;
  getObservedModel(): string | null;
  nowIso(): string;
  resolveConsolidationModel(observedModel: string | null): ConsolidationModel;
  rememberCommand(command: string, output: string, summary?: string): void;
};

type DiagnosticCommands = {
  memoryDoctor: CommandDefinition;
  memoryHealthAudit: CommandDefinition;
  memoryDiagnostics: CommandDefinition;
};

export function createDiagnosticCommands(dependencies: DiagnosticDependencies): DiagnosticCommands {
  return {
    memoryDoctor: {
      description: "Diagnose PI memory and session search setup as an interactive dashboard (use --plain or --json for scripted output)",
      handler: async (args, context) => {
        const root = dependencies.getRoot();
        const paths = ensureMemoryDirs(root);
        const config = loadConfig(root);
        const parsed = parseCommandArgs(args);
        const report = runMemoryDiagnostics(root, { profile: parsed.flags.profile === true });
        const resolvedModel = dependencies.resolveConsolidationModel(dependencies.getObservedModel());
        const header = [
          `PI memory root: ${paths.root}`,
          `Session index: ${dependencies.getSessionCount()} sessions (file-watch + 5min sync active)`,
          `Auto-curation: ${config.curator.autoCurate} (threshold: ${config.curator.autoCurateHighThreshold})`,
          `Injection mode: ${config.retrieval.injectionMode}`,
          `Consolidation model: ${resolvedModel.model ? `${resolvedModel.model} (${resolvedModel.source})` : "Pi CLI default (no --model override)"}`,
          `Vault: ${process.env.PI_VAULT_PATH ?? config.vault.path ?? "not configured (set PI_VAULT_PATH)"}`,
          `Inbox: ${listCandidates(root).filter((candidate) => candidate.status === "new").length} pending candidate(s)`,
          "",
          renderDiagnosticsReport(report),
          report.profile ? `\n${renderInvocationProfileReport(report.profile)}` : "",
        ].join("\n");
        dependencies.rememberCommand("memory-doctor", header, `doctor: ${report.summary.errors} errors, ${report.summary.warnings} warnings`);
        if (wantsPlainOutput(args) || !context.ui.custom) {
          notifyStructured(context, args, { paths, config, diagnostics: report }, header, report.summary.errors ? "error" : report.summary.warnings ? "warning" : "success");
        } else {
          await openBrowser(context, diagnosticsBrowserOptions(report), header);
        }
      },
    },
    memoryHealthAudit: {
      description: "Run a report-only autonomous memory health audit dashboard (use --plain, --json, or --save)",
      handler: async (args, context) => {
        try {
          const root = dependencies.getRoot();
          const parsed = parseCommandArgs(args);
          const report = runMemoryHealthAudit(root, { now: dependencies.nowIso() });
          const text = renderHealthAuditReport(report);
          dependencies.rememberCommand("memory-health-audit", text, `health audit: ${report.health_score.overall}/100, ${report.recommendations.length} recommendations`);
          if (parsed.flags.save === true) {
            const paths = saveHealthAuditReport(root, report);
            context.ui.notify(`Health audit saved: ${paths.markdownPath}`, "success");
          }
          if (wantsPlainOutput(args) || !context.ui.custom) {
            notifyStructured(context, args, report, text, report.health_score.overall < 80 ? "warning" : "success");
          } else {
            await openBrowser(context, healthAuditBrowserOptions(report), text);
          }
        } catch (error) {
          context.ui.notify(`Health audit failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    },
    memoryDiagnostics: {
      description: "Run memory integrity diagnostics and open an interactive dashboard (use --plain or --json for scripted output)",
      handler: async (args, context) => {
        const saveReport = args.includes("--save");
        try {
          const root = dependencies.getRoot();
          const parsed = parseCommandArgs(args);
          const report = runMemoryDiagnostics(root, { profile: parsed.flags.profile === true });
          const text = [renderDiagnosticsReport(report), report.profile ? `\n${renderInvocationProfileReport(report.profile)}` : ""].filter(Boolean).join("\n");
          dependencies.rememberCommand("memory-diagnostics", text, `diagnostics: ${report.summary.errors} errors, ${report.summary.warnings} warnings`);
          if (wantsPlainOutput(args) || !context.ui.custom) {
            notifyStructured(context, args, report, text, report.summary.errors > 0 ? "error" : report.summary.warnings > 0 ? "warning" : "success");
          } else {
            await openBrowser(context, diagnosticsBrowserOptions(report), text);
          }
          if (saveReport) {
            const path = saveDiagnosticsReport(root, report);
            context.ui.notify(`Diagnostics report saved: ${path}`, "info");
          }
        } catch (error) {
          context.ui.notify(`Diagnostics failed: ${error}`, "error");
        }
      },
    },
  };
}
