import { applyCaptureBackfill, previewCaptureBackfill, saveCaptureBackfillPreview } from "../capture-backfill";
import { auditCaptureHistory, renderCaptureAuditReport } from "../capture-audit";
import { buildCaptureQualityReport, renderCaptureQualityReport } from "../capture-quality";
import { appendEvidenceRecord, readEvidenceRecords } from "../evidence";
import { linkEvidenceToCandidate } from "../evidence-link";
import { applyLegacyEvidenceMigration, scanLegacyEvidenceMigration } from "../evidence-migration";
import { resolveMemoryProfile } from "../profile";
import { redactSecrets } from "../secret-scanner";
import { captureQualityBrowserOptions, evidenceBrowserOptions, openBrowser } from "../tui/browser-adapters";
import type { CodebaseAnalysisKind, CodebaseAnalysisTool, MemoryKind } from "../types";
import { notifyStructured, parseCommandArgs, wantsPlainOutput } from "./output";
import type { CommandDefinition } from "./types";

const CODEBASE_EVIDENCE_TOOLS = new Set<CodebaseAnalysisTool>(["tsc", "eslint", "playwright", "vitest", "fallow", "custom"]);
const CODEBASE_ANALYSIS_KINDS = new Set<CodebaseAnalysisKind>(["typecheck", "lint", "test", "e2e", "dependency", "dead_code", "complexity", "security", "duplication", "custom"]);

type CaptureDependencies = {
  getRoot(): string;
  getSessionCwd(): string;
  nowIso(): string;
  rememberCommand(command: string, output: string, summary?: string): void;
};

type CaptureCommands = {
  memoryEvidence: CommandDefinition;
  memoryCaptureBackfill: CommandDefinition;
  memoryCaptureAudit: CommandDefinition;
  memoryCaptureQuality: CommandDefinition;
};

export function createCaptureCommands(dependencies: CaptureDependencies): CaptureCommands {
  return {
    memoryEvidence: {
      description: "Manage structured evidence. Usage: /memory-evidence migrate-legacy [--apply --fingerprint <sha256>] [--json] | add-codebase-analysis ... | link <evidence-id> --statement \"...\"",
      handler: async (args, context) => {
        const root = dependencies.getRoot();
        const parsed = parseCommandArgs(args);
        const action = parsed.positional[0];
        if (!action || action === "list") {
          const evidence = readEvidenceRecords(root);
          const plain = evidence.map((item) => `${item.id} [${item.source_kind}, ${item.trust_class}, ${item.polarity}] ${item.source_summary}`).join("\n") || "No evidence records.";
          dependencies.rememberCommand("memory-evidence", plain, `evidence: ${evidence.length} records`);
          if (wantsPlainOutput(args) || !context.ui.custom) notifyStructured(context, args, evidence, plain, "info");
          else await openBrowser(context, evidenceBrowserOptions(evidence), plain);
          return;
        }
        if (action === "migrate-legacy") {
          try {
            if (parsed.flags.apply !== true) {
              const plan = scanLegacyEvidenceMigration(root);
              notifyStructured(context, args, plan, `Legacy evidence migration preview: ${plan.evidence_to_create} evidence record(s), ${plan.unresolved_references} unresolved reference(s).`, plan.evidence_to_create > 0 ? "warning" : "info");
              return;
            }
            const fingerprint = typeof parsed.flags.fingerprint === "string" ? parsed.flags.fingerprint : "";
            if (!fingerprint) {
              context.ui.notify("Apply requires the reviewed preview fingerprint. Run /memory-evidence migrate-legacy --json first.", "warning");
              return;
            }
            const result = applyLegacyEvidenceMigration(root, fingerprint, dependencies.nowIso());
            notifyStructured(context, args, result, result.mutation_performed ? `Legacy evidence migration applied. Backup: ${result.backup_path}; report: ${result.report_path}.` : "No legacy evidence migration changes were needed.", result.mutation_performed ? "success" : "info");
          } catch (error) {
            context.ui.notify(`Legacy evidence migration failed: ${error instanceof Error ? error.message : String(error)}`, "error");
          }
          return;
        }
        if (action === "link") {
          const evidenceId = parsed.positional[1];
          const statement = typeof parsed.flags.statement === "string" ? parsed.flags.statement : "";
          const tags = typeof parsed.flags.tags === "string" ? parsed.flags.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined;
          const confidence = typeof parsed.flags.confidence === "string" ? Number(parsed.flags.confidence) : undefined;
          const result = linkEvidenceToCandidate(root, {
            evidence_id: evidenceId, statement,
            kind: typeof parsed.flags.kind === "string" ? parsed.flags.kind as MemoryKind : undefined,
            tags, scope: typeof parsed.flags.scope === "string" ? parsed.flags.scope : undefined,
            confidence: Number.isFinite(confidence) ? confidence : undefined,
            forceReview: parsed.flags["force-review"] === true,
            now: dependencies.nowIso(), cwd: dependencies.getSessionCwd(),
          });
          context.ui.notify(redactSecrets(result.message), result.status === "failed" || result.status === "rejected" ? "warning" : "success");
          return;
        }
        if (action !== "add-codebase-analysis") {
          context.ui.notify("Usage: /memory-evidence add-codebase-analysis --tool <tsc|eslint|playwright|vitest|fallow|custom> --command \"<command>\" --exit-code <code> --analysis-kind <kind> OR /memory-evidence link <evidence-id> --statement \"...\"", "warning");
          return;
        }
        const tool = parsed.flags.tool;
        const analysisKind = parsed.flags["analysis-kind"];
        if (typeof tool !== "string" || !CODEBASE_EVIDENCE_TOOLS.has(tool as CodebaseAnalysisTool)) {
          context.ui.notify(`Invalid codebase evidence tool. Supported: ${[...CODEBASE_EVIDENCE_TOOLS].join(", ")}`, "error");
          return;
        }
        if (typeof analysisKind !== "string" || !CODEBASE_ANALYSIS_KINDS.has(analysisKind as CodebaseAnalysisKind)) {
          context.ui.notify(`Invalid codebase analysis kind. Supported: ${[...CODEBASE_ANALYSIS_KINDS].join(", ")}`, "error");
          return;
        }
        const command = typeof parsed.flags.command === "string" ? redactSecrets(parsed.flags.command) : undefined;
        const exitCode = typeof parsed.flags["exit-code"] === "string" ? Number(parsed.flags["exit-code"]) : undefined;
        if (exitCode !== undefined && !Number.isFinite(exitCode)) {
          context.ui.notify("Invalid --exit-code; expected a number.", "error");
          return;
        }
        const profile = resolveMemoryProfile(root, dependencies.getSessionCwd());
        try {
          const record = appendEvidenceRecord(root, {
            id: "", resource_id: profile.resource_id, profile_id: profile.profile_id, thread_id: "manual-command", created_at: dependencies.nowIso(),
            source_kind: "codebase_analysis", source_tool: tool, source_ref: command,
            source_summary: redactSecrets(typeof parsed.flags.summary === "string" ? parsed.flags.summary : `${tool} ${analysisKind} evidence${exitCode === undefined ? "" : ` (exit ${exitCode})`}`),
            trust_class: "passing_tool_or_test_outcome", polarity: exitCode === undefined || exitCode === 0 ? "supports" : "qualifies",
            durability_signal: "task", related_memory_ids: [], redaction_status: "none",
            codebase_analysis: {
              source_kind: "codebase_analysis", tool: tool as CodebaseAnalysisTool, command, exit_code: exitCode,
              file_path: typeof parsed.flags.file === "string" ? redactSecrets(parsed.flags.file) : undefined,
              symbol: typeof parsed.flags.symbol === "string" ? redactSecrets(parsed.flags.symbol) : undefined,
              analysis_kind: analysisKind as CodebaseAnalysisKind, timestamp: dependencies.nowIso(),
            },
          });
          context.ui.notify(`Added codebase-analysis evidence ${record.id}. Evidence is support, not automatic durable truth.`, "success");
        } catch (error) {
          context.ui.notify(`Failed to add codebase-analysis evidence: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    },
    memoryCaptureBackfill: {
      description: "Preview or apply fingerprinted candidate-only historical preference backfill. Usage: /memory-capture-backfill [--since YYYY-MM-DD] [--output FILE] [--apply --fingerprint HASH]",
      handler: async (args, context) => {
        try {
          const root = dependencies.getRoot();
          const parsed = parseCommandArgs(args);
          const since = typeof parsed.flags.since === "string" ? parsed.flags.since : undefined;
          if (since && !/^20\d{2}-\d{2}-\d{2}$/.test(since)) {
            context.ui.notify("Invalid --since date. Use YYYY-MM-DD.", "warning");
            return;
          }
          if (parsed.flags.apply === true) {
            const fingerprint = typeof parsed.flags.fingerprint === "string" ? parsed.flags.fingerprint : "";
            const result = applyCaptureBackfill(root, { since, fingerprint, now: dependencies.nowIso() });
            context.ui.notify(`Backfill created ${result.candidates_created} candidate(s) and reinforced ${result.candidates_reinforced}. Backup: ${result.backup_path}`, "success");
            return;
          }
          const preview = previewCaptureBackfill(root, { since, now: dependencies.nowIso() });
          const output = typeof parsed.flags.output === "string" ? saveCaptureBackfillPreview(root, preview, parsed.flags.output) : undefined;
          const text = [
            `Capture backfill preview: ${preview.candidates.length} candidate(s).`, `Fingerprint: ${preview.fingerprint}`,
            `Contaminated records: ${preview.contaminated_record_ids.length}`, `Contaminated candidates: ${preview.contaminated_candidate_ids.length}`,
            `Rescope records: ${preview.rescope_record_ids.length}`, `Skipped ambiguous-scope findings: ${preview.skipped_ambiguous_scope_count}`,
            ...(output ? [`Report: ${output}`] : []), "No mutation performed.",
          ].join("\n");
          notifyStructured(context, args, preview, text, preview.candidates.length ? "warning" : "info");
        } catch (error) {
          context.ui.notify(`Capture backfill failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    },
    memoryCaptureAudit: {
      description: "Audit historical preference capture and scope without mutation. Usage: /memory-capture-audit [--since YYYY-MM-DD] [--plain|--json]",
      handler: async (args, context) => {
        try {
          const parsed = parseCommandArgs(args);
          const since = typeof parsed.flags.since === "string" ? parsed.flags.since : undefined;
          if (since && !/^20\d{2}-\d{2}-\d{2}$/.test(since)) {
            context.ui.notify("Invalid --since date. Use YYYY-MM-DD.", "warning");
            return;
          }
          const report = auditCaptureHistory(dependencies.getRoot(), { since, now: dependencies.nowIso() });
          const text = renderCaptureAuditReport(report);
          dependencies.rememberCommand("memory-capture-audit", text, `capture audit: ${report.historical_preferences.length} historical preferences, ${report.contaminated_record_ids.length} contaminated records, ${report.contaminated_candidate_ids.length} contaminated candidates`);
          notifyStructured(context, args, report, text, report.contaminated_record_ids.length || report.rescope_proposals.length ? "warning" : "info");
        } catch (error) {
          context.ui.notify(`Capture audit failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    },
    memoryCaptureQuality: {
      description: "Show read-only preference capture funnel and scope quality. Usage: /memory-capture-quality [--plain|--json]",
      handler: async (args, context) => {
        try {
          const report = buildCaptureQualityReport(dependencies.getRoot(), { now: dependencies.nowIso() });
          const text = renderCaptureQualityReport(report);
          dependencies.rememberCommand("memory-capture-quality", text, `capture quality: ${report.messages_evaluated} evaluated, ${report.pending_candidates} pending`);
          if (wantsPlainOutput(args) || !context.ui.custom) notifyStructured(context, args, report, text, report.funnel.rejected > report.funnel.candidate_created ? "warning" : "info");
          else await openBrowser(context, captureQualityBrowserOptions(report), text);
        } catch (error) {
          context.ui.notify(`Capture quality analysis failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    },
  };
}
