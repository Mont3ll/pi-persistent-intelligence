import { loadConfig } from "../config";
import { applyInquiryStaleness, planInquiryStaleness, readInquiryRecords, transitionInquiry } from "../inquiries";
import { recordExplicitReinforcement } from "../reinforcement";
import { inquiryBrowserOptions, openBrowser } from "../tui/browser-adapters";
import { notifyStructured, parseCommandArgs, wantsPlainOutput } from "./output";
import type { CommandDefinition } from "./types";

type ReinforcementDependencies = {
  getRoot(): string;
  nowIso(): string;
};

type ReinforcementCommands = {
  memoryReinforce: CommandDefinition;
  memoryInquiries: CommandDefinition;
};

export function createReinforcementCommands(dependencies: ReinforcementDependencies): ReinforcementCommands {
  return {
    memoryReinforce: {
      description: "Record explicit positive reinforcement without mutating memory. Usage: /memory-reinforce <memory-id> --note \"User confirmed this remains correct.\" [--json]",
      handler: async (args, context) => {
        const parsed = parseCommandArgs(args);
        const memoryId = parsed.positional[0];
        const note = typeof parsed.flags.note === "string" ? parsed.flags.note : "";
        try {
          if (!memoryId || !note) throw new Error("Usage: /memory-reinforce <memory-id> --note \"confirmation\"");
          const result = recordExplicitReinforcement(dependencies.getRoot(), { memory_id: memoryId, note, session_id: "current-session", now: dependencies.nowIso() });
          notifyStructured(context, args, result, result.created ? `Recorded explicit reinforcement for ${memoryId}.` : `Identical reinforcement already exists for ${memoryId} in this session.`, result.created ? "success" : "info");
        } catch (error) {
          context.ui.notify(`Memory reinforcement failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    },
    memoryInquiries: {
      description: "Review inquiry lifecycle. Usage: /memory-inquiries list ... | answer <id> --memory <memory-id> | withdraw <id> | stale <id> | stale-scan [--apply --fingerprint <sha256>] [--json]",
      handler: async (args, context) => {
        const root = dependencies.getRoot();
        const parsed = parseCommandArgs(args);
        const action = parsed.positional[0] ?? "list";
        try {
          if (action === "stale-scan") {
            const reviewWindowDays = loadConfig(root).inquiries.reviewWindowDays;
            if (parsed.flags.apply !== true) {
              const plan = planInquiryStaleness(readInquiryRecords(root), reviewWindowDays, dependencies.nowIso());
              notifyStructured(context, args, plan, `Inquiry staleness preview: ${plan.stale_candidates} candidate(s) older than ${reviewWindowDays} days.`, plan.stale_candidates > 0 ? "warning" : "info");
              return;
            }
            const fingerprint = typeof parsed.flags.fingerprint === "string" ? parsed.flags.fingerprint : "";
            if (!fingerprint) throw new Error("Apply requires the reviewed stale-scan fingerprint.");
            const result = applyInquiryStaleness(root, fingerprint, reviewWindowDays, dependencies.nowIso());
            notifyStructured(context, args, result, result.mutation_performed ? `Marked ${result.inquiries_staled} inquiry(s) stale. Backup: ${result.backup_path}.` : "No inquiries required staleness changes.", result.mutation_performed ? "success" : "info");
            return;
          }
          if (action === "list") {
            const status = typeof parsed.flags.status === "string" ? parsed.flags.status : undefined;
            const allowed = new Set(["open", "answered", "withdrawn", "stale"]);
            if (status && !allowed.has(status)) throw new Error(`Invalid inquiry status ${status}.`);
            const inquiries = readInquiryRecords(root).filter((inquiry) => !status || inquiry.status === status);
            const plain = inquiries.map((inquiry) => `${inquiry.id} [${inquiry.status}] ${inquiry.question}`).join("\n") || "No inquiries.";
            if (wantsPlainOutput(args) || !context.ui.custom) notifyStructured(context, args, inquiries, plain, "info");
            else await openBrowser(context, inquiryBrowserOptions(inquiries), plain);
            return;
          }
          const inquiryId = parsed.positional[1];
          if (!inquiryId || !["answer", "withdraw", "stale"].includes(action)) throw new Error("Usage: /memory-inquiries answer <id> --memory <memory-id> | withdraw <id> | stale <id>");
          const result = transitionInquiry(root, {
            inquiry_id: inquiryId,
            status: action === "answer" ? "answered" : action === "withdraw" ? "withdrawn" : "stale",
            answer_memory_id: typeof parsed.flags.memory === "string" ? parsed.flags.memory : undefined,
            now: dependencies.nowIso(),
          });
          notifyStructured(context, args, result, `Inquiry ${result.inquiry_id}: ${result.previous_status} → ${result.status}.`, "success");
        } catch (error) {
          context.ui.notify(`Inquiry command failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      },
    },
  };
}
