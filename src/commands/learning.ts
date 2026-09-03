import { runFailureAnalysis, renderFailureAnalysisReport } from "../failure-analysis";
import { generateProcedureCandidates, renderProcedureCandidateReport, saveProcedureCandidateReport } from "../procedure-candidates";
import { redactSecrets } from "../secret-scanner";
import { draftSkillFromProcedureCandidate } from "../skill-draft";
import { parseCommandArgs } from "./output";
import type { CommandDefinition } from "./types";

type LearningDependencies = {
  getRoot(): string;
  nowIso(): string;
};

type LearningCommands = {
  procedureCandidates: CommandDefinition;
  memorySkill: CommandDefinition;
  memoryFailures: CommandDefinition;
};

export function createLearningCommands(dependencies: LearningDependencies): LearningCommands {
  return {
    procedureCandidates: {
      description: "Generate review-only procedure candidates from repeated workflow memory",
      handler: async (args, context) => {
        try {
          const root = dependencies.getRoot();
          const report = generateProcedureCandidates(root, { now: dependencies.nowIso() });
          context.ui.notify(renderProcedureCandidateReport(report), report.candidates.length ? "success" : "info");
          if (args.includes("--save")) {
            const paths = saveProcedureCandidateReport(root, report);
            context.ui.notify(`Procedure candidate report saved: ${paths.mdPath}`, "success");
          }
        } catch (error) {
          context.ui.notify(`Procedure candidates failed: ${error}`, "error");
        }
      },
    },
    memorySkill: {
      description: "Generate review-only skill draft artifacts from procedure candidates. Usage: /memory-skill draft <procedure-candidate-id>",
      handler: async (args, context) => {
        const parsed = parseCommandArgs(args);
        if (parsed.positional[0] !== "draft") {
          context.ui.notify("Usage: /memory-skill draft <procedure-candidate-id>", "warning");
          return;
        }
        const result = draftSkillFromProcedureCandidate(dependencies.getRoot(), parsed.positional[1] ?? "", dependencies.nowIso());
        context.ui.notify(redactSecrets(result.message), result.status === "draft_created" ? "success" : "error");
      },
    },
    memoryFailures: {
      description: "Analyze failed jobs/rejected candidates into review-only learning artifacts. Usage: /memory-failures analyze [--save]",
      handler: async (args, context) => {
        const parsed = parseCommandArgs(args);
        if ((parsed.positional[0] ?? "analyze") !== "analyze") {
          context.ui.notify("Usage: /memory-failures analyze [--save]", "warning");
          return;
        }
        const { report, path } = runFailureAnalysis(dependencies.getRoot(), { now: dependencies.nowIso(), save: parsed.flags.save === true });
        context.ui.notify(renderFailureAnalysisReport(report), "info");
        if (path) context.ui.notify(`Failure analysis saved: ${path}`, "success");
      },
    },
  };
}
