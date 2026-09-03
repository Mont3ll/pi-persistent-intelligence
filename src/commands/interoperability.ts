import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config";
import { exportToPiGovernanceBundle, importFromPiGovernanceBundle, runPiGovernanceDoctor } from "../pi-governance-compat";
import { reconcilePiGovernanceBundles } from "../pi-governance-reconciliation";
import { resolveMemoryProfile } from "../profile";
import { notifyStructured, parseCommandArgs } from "./output";
import type { CommandDefinition } from "./types";

type InteroperabilityDependencies = {
  getRoot(): string;
  getSessionCwd(): string;
};

type InteroperabilityCommands = {
  memoryExport: CommandDefinition;
  memoryImport: CommandDefinition;
  memoryReconcile: CommandDefinition;
  memoryGovernance: CommandDefinition;
};

export function createInteroperabilityCommands(dependencies: InteroperabilityDependencies): InteroperabilityCommands {
  return {
    memoryExport: {
      description: "Export memory bundles. Usage: /memory-export --format pi-governance [--redacted] [--output bundle.json]",
      handler: async (args, context) => {
        const parsed = parseCommandArgs(args);
        if (parsed.flags.format !== "pi-governance") {
          context.ui.notify("Usage: /memory-export --format pi-governance [--redacted] [--output bundle.json]", "warning");
          return;
        }
        const root = dependencies.getRoot();
        const config = loadConfig(root);
        const outputPath = typeof parsed.flags.output === "string" ? parsed.flags.output : join(root, "runtime", `pi-governance-export-${Date.now()}.json`);
        const profile = resolveMemoryProfile(root, dependencies.getSessionCwd());
        const bundle = exportToPiGovernanceBundle(root, {
          namespace: typeof parsed.flags.namespace === "string" ? parsed.flags.namespace : config.piGovernance.namespace,
          project: typeof parsed.flags.project === "string" ? parsed.flags.project : undefined,
          profile_id: profile.profile_id,
          redacted: parsed.flags.redacted === true,
        });
        writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf-8");
        context.ui.notify(`Exported pi-governance bundle: ${outputPath}`, "success");
      },
    },
    memoryImport: {
      description: "Import memory bundles. Usage: /memory-import --format pi-governance <bundle.json> [--apply] [--backup] [--redacted-aware]",
      handler: async (args, context) => {
        const parsed = parseCommandArgs(args);
        if (parsed.flags.format !== "pi-governance" || !parsed.positional[0]) {
          context.ui.notify("Usage: /memory-import --format pi-governance <bundle.json> [--apply] [--backup] [--redacted-aware]", "warning");
          return;
        }
        const bundle = JSON.parse(readFileSync(parsed.positional[0], "utf-8"));
        const result = importFromPiGovernanceBundle(dependencies.getRoot(), bundle, {
          dryRun: parsed.flags.apply !== true,
          backup: parsed.flags.backup === true,
          redactedAware: parsed.flags["redacted-aware"] === true,
        });
        context.ui.notify(JSON.stringify(result, null, 2), result.dry_run ? "info" : "success");
      },
    },
    memoryReconcile: {
      description: "Compare local memory with an independent peer bundle without mutation. Usage: /memory-reconcile <peer-bundle.json> [--project <name>] [--profile <id>] [--json]",
      handler: async (args, context) => {
        try {
          const parsed = parseCommandArgs(args);
          const peerPath = parsed.positional[0];
          if (!peerPath) {
            context.ui.notify("Usage: /memory-reconcile <peer-bundle.json> [--project <name>] [--profile <id>] [--json]", "warning");
            return;
          }
          const root = dependencies.getRoot();
          const config = loadConfig(root);
          const source = exportToPiGovernanceBundle(root, {
            namespace: config.piGovernance.namespace,
            project: typeof parsed.flags.project === "string" ? parsed.flags.project : undefined,
            profile_id: typeof parsed.flags.profile === "string" ? parsed.flags.profile : undefined,
          });
          const destination = JSON.parse(readFileSync(peerPath, "utf-8"));
          const report = reconcilePiGovernanceBundles(source, destination);
          const text = `Reconciliation is report-only: ${report.artifact_counts.records.source} local record(s), ${report.artifact_counts.records.destination} peer record(s), ${report.sections.records.divergent_ids.length} divergent ID(s).`;
          notifyStructured(context, args, report, text, report.sections.records.divergent_ids.length > 0 ? "warning" : "info");
        } catch (error) {
          context.ui.notify(`Memory reconciliation failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    },
    memoryGovernance: {
      description: "Check optional pi-governance-rs bridge status. Usage: /memory-governance doctor",
      handler: async (args, context) => {
        if ((parseCommandArgs(args).positional[0] ?? "doctor") !== "doctor") {
          context.ui.notify("Usage: /memory-governance doctor", "warning");
          return;
        }
        const report = runPiGovernanceDoctor(dependencies.getRoot());
        context.ui.notify(JSON.stringify(report, null, 2), report.ok ? "success" : "warning");
      },
    },
  };
}
