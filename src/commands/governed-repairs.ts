import { applyMemoryKeyRepair, scanMemoryKeyRepair } from "../memory-key-repair";
import { applyStoreIntegrityPlan, scanStoreIntegrity } from "../store-integrity";
import { notifyStructured, parseCommandArgs } from "./output";
import type { CommandDefinition } from "./types";

type GovernedRepairDependencies = {
  getRoot(): string;
  nowIso(): string;
};

type GovernedRepairCommands = {
  memoryStoreIntegrity: CommandDefinition;
  memoryKeyRepair: CommandDefinition;
};

export function createGovernedRepairCommands(dependencies: GovernedRepairDependencies): GovernedRepairCommands {
  return {
    memoryStoreIntegrity: {
      description: "Preview or apply canonical record integrity repairs. Usage: /memory-store-integrity [--apply --fingerprint <sha256>] [--json]",
      handler: async (args, context) => {
        try {
          const parsed = parseCommandArgs(args);
          const apply = parsed.flags.apply === true;
          if (!apply) {
            const plan = scanStoreIntegrity(dependencies.getRoot());
            const text = plan.migration_needed
              ? `Store integrity repair available: ${plan.rows_before} rows → ${plan.rows_after}; fingerprint ${plan.fingerprint}. Review this result, then apply with --apply --fingerprint ${plan.fingerprint}.`
              : `Store integrity is clean: ${plan.rows_before} row(s), ${plan.unique_ids_before} unique ID(s).`;
            notifyStructured(context, args, plan, text, plan.migration_needed ? "warning" : "success");
            return;
          }
          const expectedFingerprint = typeof parsed.flags.fingerprint === "string" ? parsed.flags.fingerprint : "";
          if (!expectedFingerprint) {
            context.ui.notify("Apply requires the reviewed preview fingerprint. Run /memory-store-integrity --json, then use --apply --fingerprint <sha256>.", "warning");
            return;
          }
          const result = applyStoreIntegrityPlan(dependencies.getRoot(), expectedFingerprint, dependencies.nowIso());
          const text = result.mutation_performed
            ? `Store integrity repair applied. Backup: ${result.backup_path}; report: ${result.report_path}.`
            : "Store integrity apply made no changes.";
          notifyStructured(context, args, result, text, result.mutation_performed ? "success" : "info");
        } catch (error) {
          context.ui.notify(`Store integrity failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    },
    memoryKeyRepair: {
      description: "Preview or apply versioned normalized-memory-key repairs. Usage: /memory-key-repair [--apply --fingerprint <sha256>] [--json]",
      handler: async (args, context) => {
        try {
          const parsed = parseCommandArgs(args);
          const apply = parsed.flags.apply === true;
          if (!apply) {
            const plan = scanMemoryKeyRepair(dependencies.getRoot());
            const text = plan.targetCount > 0
              ? `Normalized key repair preview: ${plan.targetCount} target(s), ${plan.collisions.length} collision(s), fingerprint ${plan.fingerprint}. Review the JSON before apply.`
              : "No active normalized-memory-key repairs are needed.";
            notifyStructured(context, args, plan, text, plan.targetCount > 0 ? "warning" : "success");
            return;
          }
          const expectedFingerprint = typeof parsed.flags.fingerprint === "string" ? parsed.flags.fingerprint : "";
          if (!expectedFingerprint) {
            context.ui.notify("Apply requires the reviewed preview fingerprint. Run /memory-key-repair --json, then use --apply --fingerprint <sha256>.", "warning");
            return;
          }
          const result = applyMemoryKeyRepair(dependencies.getRoot(), expectedFingerprint, dependencies.nowIso());
          const text = result.mutationPerformed
            ? `Normalized key repair applied. Backup: ${result.backupPath}; report: ${result.reportPath}.`
            : "Normalized key repair apply made no changes.";
          notifyStructured(context, args, result, text, result.mutationPerformed ? "success" : "info");
        } catch (error) {
          context.ui.notify(`Normalized key repair failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    },
  };
}
