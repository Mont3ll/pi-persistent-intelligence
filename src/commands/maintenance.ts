import { type ConsolidationRunner, runConsolidation } from "../consolidator";
import { loadConfig } from "../config";
import { curateInbox } from "../curator";
import { todayString } from "../daily";
import { renderGovernanceSimulationReport, simulatePatchImpact } from "../governance-simulation";
import { maintainMemory as buildMaintenancePatch } from "../maintainer";
import { buildStabilityPatchFromRecommendations, generateMaintenanceRecommendations, generateMaintenanceReport } from "../maintenance";
import { DEFAULT_META_CONSOLIDATION_CONFIG, generateGoalHandoffSnapshot, generateHandoffSnapshot, runMetaConsolidation } from "../meta-consolidation";
import { applyPatch, listPatchFiles, readPatchFile } from "../patch";
import { applyPatchAndSync } from "../patch-sync";
import { resolveMemoryProfile } from "../profile";
import { readReinforcementEventsForMemory, summarizeReinforcement } from "../reinforcement";
import { renderMemoryToDisk } from "../render";
import { syncFtsIndex } from "../retriever";
import { appendRuntimeEvent } from "../runtime-events";
import type { MemoryFtsIndex } from "../search/fts";
import { loadActiveRecords } from "../store";
import { updateQmd } from "../qmd";
import type { MemoryPatch } from "../types";
import { notifyStructured, parseCommandArgs } from "./output";
import type { CommandDefinition } from "./types";

type ConsolidationModel = { model: string | null; source: "env" | "current" | "pi-default" };

type MaintenanceDependencies = {
  getRoot(): string;
  getSessionCwd(): string;
  getFtsIndex(): MemoryFtsIndex;
  getPendingUserMessages(): string[];
  getPendingAssistantMessages(): string[];
  getObservedModel(): string | null;
  getRunner(): ConsolidationRunner;
  nowIso(): string;
  rememberCommand(command: string, output: string, summary?: string): void;
  syncFtsAfterPatch(patch: MemoryPatch, applied: MemoryPatch): void;
  resolveConsolidationModel(observedModel: string | null): ConsolidationModel;
};

type MaintenanceCommands = {
  curateMemory: CommandDefinition;
  maintainMemory: CommandDefinition;
  memorySimulatePatch: CommandDefinition;
  memoryPatches: CommandDefinition;
  applyMemoryPatch: CommandDefinition;
  metaConsolidation: CommandDefinition;
  memoryHandoff: CommandDefinition;
  renderMemory: CommandDefinition;
  consolidateMemory: CommandDefinition;
};

export function createMaintenanceCommands(dependencies: MaintenanceDependencies): MaintenanceCommands {
  return {
    curateMemory: {
      description: "Curate inbox into patch proposals (with vault_ref hints)",
      handler: async (args, context) => {
        const root = dependencies.getRoot();
        const mode = args.includes("--mode=auto") ? "auto" : args.includes("--mode=supervised") ? "supervised" : "propose";
        const patch = curateInbox(root, { now: dependencies.nowIso(), mode, vaultPath: process.env.PI_VAULT_PATH });
        if (mode === "auto") {
          const applied = applyPatch(root, patch, { selectedOpIds: patch.ops.filter((operation) => operation.default_selected && operation.risk !== "high").map((operation) => operation.op_id), now: dependencies.nowIso() });
          await updateQmd();
          dependencies.syncFtsAfterPatch(patch, applied);
          context.ui.notify(`Applied ${applied.applied_ops.length} memory op(s) from ${applied.patch_id}`, "success");
        } else if (patch.ops.length === 0) {
          context.ui.notify("No candidates meet curation thresholds.", "info");
        } else if (context.ui.custom) {
          const { createPatchReviewComponent } = await import("../tui/PatchReviewPanel");
          const selectedIds = await context.ui.custom<string[] | null>((tui, theme, _keybindings, done) => createPatchReviewComponent(patch, done, tui as any, undefined, theme));
          if (selectedIds && selectedIds.length > 0) {
            const applied = applyPatch(root, patch, { selectedOpIds: selectedIds, now: dependencies.nowIso() });
            await updateQmd();
            dependencies.syncFtsAfterPatch(patch, applied);
            context.ui.notify(`✓ Applied ${selectedIds.length} memory op(s).`, "success");
          } else if (selectedIds === null) {
            context.ui.notify("Curation cancelled — no changes made.", "info");
          }
        } else {
          context.ui.notify(`${patch.patch_id}: ${patch.summary}`, "info");
          if (patch.ops.length > 0) context.ui.notify(patch.ops.map((operation) => `  ${operation.op_id}: ${operation.rationale}`).join("\n"), "info");
        }
      },
    },
    maintainMemory: {
      description: "Generate maintenance patch for overdue records and reinforcement-based recommendations",
      handler: async (args, context) => {
        const root = dependencies.getRoot();
        const mode = args.includes("--mode=auto") ? "auto" : args.includes("--mode=supervised") ? "supervised" : "propose";
        const showReport = args.includes("--report");
        const patch = buildMaintenancePatch(root, { now: dependencies.nowIso(), mode });
        const records = loadActiveRecords(root);
        const summaries = records.map((record) => summarizeReinforcement(readReinforcementEventsForMemory(root, record.id))).filter((summary) => summary.counts.explicit_correction > 0 || summary.counts.explicit_reinforcement > 0 || summary.counts.implicit_success > 0);
        const recommendations = generateMaintenanceRecommendations(records, summaries, dependencies.nowIso());
        const stabilityPatch = buildStabilityPatchFromRecommendations(recommendations, dependencies.nowIso());
        if (showReport) context.ui.notify(generateMaintenanceReport(recommendations, records).slice(0, 2000), "info");
        if (mode === "auto") {
          const decayOps = patch.ops.filter((operation) => operation.default_selected && operation.risk !== "high").map((operation) => operation.op_id);
          if (decayOps.length > 0) {
            const applied = applyPatch(root, patch, { selectedOpIds: decayOps, now: dependencies.nowIso() });
            await updateQmd();
            dependencies.syncFtsAfterPatch(patch, applied);
            context.ui.notify(`Applied ${applied.applied_ops.length} maintenance ops from ${applied.patch_id}`, "success");
          }
          const stabilityOps = stabilityPatch.ops.filter((operation) => operation.default_selected && operation.risk !== "high").map((operation) => operation.op_id);
          if (stabilityOps.length > 0) {
            const applied = applyPatch(root, stabilityPatch, { selectedOpIds: stabilityOps, now: dependencies.nowIso() });
            dependencies.syncFtsAfterPatch(stabilityPatch, applied);
            context.ui.notify(`Applied ${applied.applied_ops.length} stability ops.`, "success");
          }
          const reviewCount = recommendations.filter((recommendation) => recommendation.requires_review).length;
          if (reviewCount > 0) context.ui.notify(`${reviewCount} recommendation(s) require human review.`, "warning");
        } else {
          context.ui.notify(`${patch.patch_id}: ${patch.summary}`, "info");
          if (recommendations.length > 0) context.ui.notify(`Reinforcement: ${recommendations.length} maintenance recommendation(s). Use --report to see details.`, "info");
        }
      },
    },
    memorySimulatePatch: {
      description: "Preview patch effects on quality scores without applying mutation. Usage: /memory-simulate-patch <patch-id> [--plain|--json]",
      handler: async (args, context) => {
        const parsed = parseCommandArgs(args);
        const patchId = parsed.positional[0];
        if (!patchId) {
          context.ui.notify("Usage: /memory-simulate-patch <patch-id> [--plain|--json]", "warning");
          return;
        }
        try {
          const root = dependencies.getRoot();
          const patch = readPatchFile(root, patchId);
          const report = simulatePatchImpact(root, patch, { now: dependencies.nowIso() });
          const text = renderGovernanceSimulationReport(report);
          dependencies.rememberCommand("memory-simulate-patch", text, `simulate patch ${patch.patch_id}: store delta ${report.deltas.store_quality_delta}`);
          notifyStructured(context, args, report, text, report.deltas.store_quality_delta < 0 ? "warning" : "info");
        } catch (error) {
          context.ui.notify(`Patch simulation failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    },
    memoryPatches: {
      description: "List pending patch files",
      handler: async (_args, context) => {
        const root = dependencies.getRoot();
        const ids = listPatchFiles(root);
        if (ids.length === 0) {
          context.ui.notify("No patch files.", "info");
          return;
        }
        const summaries = ids.map((id) => {
          try { const patch = readPatchFile(root, id); return `${id} [${patch.status}]: ${patch.summary}`; }
          catch { return id; }
        });
        context.ui.notify(summaries.join("\n"), "info");
      },
    },
    applyMemoryPatch: {
      description: "Apply selected ops from a patch file by id",
      handler: async (args, context) => {
        const patchId = args.trim().split(/\s+/)[0];
        if (!patchId) {
          context.ui.notify("Usage: /apply-memory-patch <patch_id>", "warning");
          return;
        }
        try {
          const root = dependencies.getRoot();
          const patch = readPatchFile(root, patchId);
          if (patch.ops.some((operation) => operation.op === "delete")) {
            const applied = applyPatchAndSync(root, patch, { now: dependencies.nowIso() }, dependencies.getFtsIndex());
            await updateQmd();
            context.ui.notify(`Applied ${applied.applied_ops.length} op(s) from ${patchId} (FTS synced).`, "success");
          } else {
            const applied = applyPatch(root, patch, { now: dependencies.nowIso() });
            await updateQmd();
            dependencies.syncFtsAfterPatch(patch, applied);
            context.ui.notify(`Applied ${applied.applied_ops.length} op(s) from ${patchId}.`, "success");
          }
        } catch (error) {
          context.ui.notify(`Failed to apply patch: ${error}`, "error");
        }
      },
    },
    metaConsolidation: {
      description: "Propose L1 abstractions from stable L2 record clusters (always requires human review)",
      handler: async (args, context) => {
        const root = dependencies.getRoot();
        const config = loadConfig(root);
        const metaConfig = { ...DEFAULT_META_CONSOLIDATION_CONFIG, ...config.metaConsolidation, enabled: true, cadence: "manual" as const };
        const profile = resolveMemoryProfile(root, dependencies.getSessionCwd());
        context.ui.notify("Running meta-consolidation (no automatic changes)…", "info");
        try {
          const run = runMetaConsolidation(root, metaConfig, profile.profile_id, dependencies.nowIso());
          context.ui.notify(`Meta-consolidation: ${run.clusters.length} cluster(s), ${run.candidates.length} L1 candidate(s) proposed.\nReport: ${run.report_path ?? "(none)"}`, "success");
          if (run.candidates.length > 0) context.ui.notify(`All ${run.candidates.length} candidate(s) are l1_review_only — manually inspect report and apply patch if desired.`, "warning");
          if (args.includes("--handoff")) {
            const snapshot = generateHandoffSnapshot(root, { profile_id: profile.profile_id, now: dependencies.nowIso() });
            context.ui.notify(`Handoff snapshot: ${snapshot.active_l2_count} L2 records, ${snapshot.open_inquiry_count} open inquiries.`, "info");
          }
        } catch (error) {
          context.ui.notify(`Meta-consolidation failed: ${error}`, "error");
        }
      },
    },
    memoryHandoff: {
      description: "Generate a handoff snapshot of current active memory state. Use --goal <goal> for goal handoff.",
      handler: async (args, context) => {
        try {
          const root = dependencies.getRoot();
          const profile = resolveMemoryProfile(root, dependencies.getSessionCwd());
          if (args.includes("--goal")) {
            const declaredGoal = args.replace("--goal", "").trim() || "Continue current goal safely.";
            const snapshot = generateGoalHandoffSnapshot(root, { declared_goal: declaredGoal, profile_id: profile.profile_id, now: dependencies.nowIso() });
            context.ui.notify(`Goal handoff: ${snapshot.active_memory_ids.length} active memories, ${snapshot.open_inquiry_ids.length} open inquiries, ${snapshot.pending_candidate_ids.length} pending candidates. ${snapshot.background_reference_warning}`, "success");
            return;
          }
          const snapshot = generateHandoffSnapshot(root, { profile_id: profile.profile_id, now: dependencies.nowIso() });
          context.ui.notify(`Handoff snapshot: ${snapshot.active_l2_count} L2 records, ${snapshot.open_inquiry_count} open inquiries, ${snapshot.pending_candidate_count} pending candidates.`, "success");
        } catch (error) {
          context.ui.notify(`Handoff failed: ${error}`, "error");
        }
      },
    },
    renderMemory: {
      description: "Render canonical JSONL to markdown",
      handler: async (_args, context) => {
        const root = dependencies.getRoot();
        renderMemoryToDisk(root);
        await updateQmd();
        syncFtsIndex(root, dependencies.getFtsIndex());
        context.ui.notify("Rendered memory markdown projection", "success");
      },
    },
    consolidateMemory: {
      description: "Manually trigger LLM consolidation from current session messages",
      handler: async (_args, context) => {
        const userMessages = dependencies.getPendingUserMessages();
        if (userMessages.length < 2) {
          context.ui.notify("Not enough conversation to consolidate (need at least 2 user messages).", "warning");
          return;
        }
        const root = dependencies.getRoot();
        const resolved = dependencies.resolveConsolidationModel(dependencies.getObservedModel());
        const modelLabel = resolved.model ? `${resolved.model} (${resolved.source})` : "Pi CLI default";
        context.ui.notify(`Running consolidation using ${modelLabel}…`, "info");
        const result = await runConsolidation(root, userMessages, dependencies.getPendingAssistantMessages(), todayString(), dependencies.getSessionCwd(), dependencies.getRunner(), resolved.model);
        await updateQmd();
        syncFtsIndex(root, dependencies.getFtsIndex());
        if (result.status === "failed") {
          const reason = result.failure_reason ?? "unknown failure";
          appendRuntimeEvent(root, { type: "warn", severity: "medium", component: "consolidation", message: `manual consolidation failed using ${modelLabel}: ${reason}` });
          context.ui.notify(`Consolidation failed using ${modelLabel}: ${reason}`, "error");
        } else if (result.candidates_added > 0) {
          context.ui.notify(`Added ${result.candidates_added} candidate(s) to inbox (${result.candidates_skipped_dedup} deduped). Run /curate-memory to review.`, "success");
        } else {
          context.ui.notify(`No new patterns extracted (${result.candidates_skipped_dedup} deduped as already known).`, "info");
        }
      },
    },
  };
}
