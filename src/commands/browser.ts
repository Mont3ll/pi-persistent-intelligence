import { loadConfig } from "../config";
import { curateInbox } from "../curator";
import { listCandidates } from "../inbox";
import { applyPatch } from "../patch";
import { updateQmd } from "../qmd";
import { recordExplicitReinforcement } from "../reinforcement";
import { renderMemoryToDisk } from "../render";
import { syncFtsIndex } from "../retriever";
import type { MemoryFtsIndex } from "../search/fts";
import { loadActiveRecords } from "../store";
import { candidateBrowserOptions, memoryRecordBrowserOptions, openBrowser } from "../tui/browser-adapters";
import type { InboxOverlayAction } from "../tui/InboxReviewOverlay";
import { createPatchReviewComponent } from "../tui/PatchReviewPanel";
import type { MemoryPatch } from "../types";
import { notifyStructured, wantsPlainOutput } from "./output";
import type { CommandDefinition } from "./types";

export type CommandHistoryEntry = { id: string; command: string; created_at: string; summary: string; output: string };

type BrowserDependencies = {
  getRoot(): string;
  getCommandHistory(): CommandHistoryEntry[];
  getFtsIndex(): MemoryFtsIndex;
  nowIso(): string;
  rememberCommand(command: string, output: string, summary?: string): void;
  syncFtsAfterPatch(patch: MemoryPatch, applied: MemoryPatch): void;
};

type BrowserCommands = {
  memoryHistory: CommandDefinition;
  memoryInbox: CommandDefinition;
  memoryLearnings: CommandDefinition;
};

export function createBrowserCommands(dependencies: BrowserDependencies): BrowserCommands {
  return {
    memoryHistory: {
      description: "Browse previous PI interactive command outputs without rerunning them",
      handler: async (args, context) => {
        const commandHistory = dependencies.getCommandHistory();
        const plain = commandHistory.map((entry, index) => `${index + 1}. ${entry.created_at} ${entry.command} — ${entry.summary}`).join("\n") || "No PI command history in this session.";
        if (wantsPlainOutput(args) || !context.ui.custom) {
          notifyStructured(context, args, commandHistory, plain, "info");
          return;
        }
        await openBrowser(context, {
          title: "Command Result History",
          subtitle: "Session-local result cache. Selecting expands stored output; no command is rerun.",
          items: commandHistory.map((entry) => ({ id: entry.id, item: entry, status: "info" as const, searchText: `${entry.command} ${entry.summary} ${entry.output}`, details: entry.output.split(/\r?\n/).slice(0, 200) })),
          pageSize: 20,
          columns: [
            { key: "created", label: "Created", width: 20, minWidth: 10, priority: 2, render: (entry: CommandHistoryEntry) => entry.created_at, sortValue: (entry: CommandHistoryEntry) => entry.created_at },
            { key: "command", label: "Command", width: 22, minWidth: 10, priority: 1, render: (entry: CommandHistoryEntry) => entry.command },
            { key: "summary", label: "Summary", minWidth: 20, priority: 1, render: (entry: CommandHistoryEntry) => entry.summary },
          ],
        }, plain);
      },
    },
    memoryInbox: {
      description: "Show and interactively review pending inbox candidates",
      handler: async (args, context) => {
        const root = dependencies.getRoot();
        const candidates = listCandidates(root).filter((candidate) => candidate.status === "new");
        if (candidates.length === 0) {
          context.ui.notify("Inbox empty.", "info");
          return;
        }
        const plain = candidates.map((candidate, index) => `${index + 1}. [conf ${(candidate.confidence ?? 0).toFixed(2)}${candidate.ruleType ? ", " + candidate.ruleType : ""}] ${candidate.text.slice(0, 120)}`).join("\n");
        dependencies.rememberCommand("memory-inbox", plain, `inbox: ${candidates.length} candidates`);
        if (wantsPlainOutput(args) || !context.ui.custom) {
          notifyStructured(context, args, candidates, `${candidates.length} pending candidate(s):\n${plain}`, "info");
          return;
        }
        const config = loadConfig(root);
        const threshold = config.curator.autoCurateHighThreshold ?? 0.85;
        const vaultPath = config.vault.path ?? process.env.PI_VAULT_PATH;
        try {
          const result = await openBrowser(context, candidateBrowserOptions(candidates), plain);
          const action = result?.action as InboxOverlayAction | undefined;
          if (action === "approve") {
            const patch = curateInbox(root, { now: dependencies.nowIso(), mode: "auto", vaultPath, minEvidenceCount: 1 });
            const eligibleIds = patch.ops.filter((operation) => operation.risk !== "high" && (operation.record?.confidence ?? operation.to_record?.confidence ?? 0) >= threshold).map((operation) => operation.op_id);
            if (eligibleIds.length > 0) {
              const applied = applyPatch(root, patch, { selectedOpIds: eligibleIds, now: dependencies.nowIso() });
              await updateQmd();
              dependencies.syncFtsAfterPatch(patch, applied);
              context.ui.notify(`✓ Applied ${eligibleIds.length} memory op(s).`, "success");
            } else {
              context.ui.notify("No auto-eligible ops above confidence threshold.", "info");
            }
          } else if (action === "review") {
            const reviewPatch = curateInbox(root, { now: dependencies.nowIso(), mode: "propose", vaultPath, minEvidenceCount: 1 });
            if (reviewPatch.ops.length > 0 && context.ui.custom) {
              const selectedIds = await context.ui.custom<string[] | null>((tui, theme, _keybindings, done) => createPatchReviewComponent(reviewPatch, done, tui as any, undefined, theme));
              if (selectedIds && selectedIds.length > 0) {
                const applied = applyPatch(root, reviewPatch, { selectedOpIds: selectedIds, now: dependencies.nowIso() });
                await updateQmd();
                dependencies.syncFtsAfterPatch(reviewPatch, applied);
                context.ui.notify(`✓ Applied ${selectedIds.length} memory op(s).`, "success");
              }
            } else {
              context.ui.notify("No candidates meet curation thresholds.", "info");
            }
          }
        } catch {
          context.ui.notify(`${candidates.length} pending candidate(s):\n${plain}`, "info");
        }
      },
    },
    memoryLearnings: {
      description: "Browse and manage long-term memory records in an interactive pageable table (use --plain or --json for scripted output)",
      handler: async (args, context) => {
        const root = dependencies.getRoot();
        const records = loadActiveRecords(root).filter((record) => record.status === "active").sort((left, right) => right.confidence - left.confidence);
        const plain = records.map((record) => `[${record.layer}, conf ${record.confidence.toFixed(2)}${record.ruleType ? ", " + record.ruleType : ""}] ${record.statement}`).join("\n") || "No memory records.";
        dependencies.rememberCommand("memory-learnings", plain, `memory: ${records.length} active records`);
        if (wantsPlainOutput(args) || !context.ui.custom) {
          notifyStructured(context, args, records, plain, "info");
          return;
        }
        const result = await openBrowser(context, memoryRecordBrowserOptions(records), plain);
        if (result?.action === "reinforce" && result.id) {
          try {
            const reinforcement = recordExplicitReinforcement(root, { memory_id: result.id, note: "Confirmed from memory browser.", session_id: "current-session", now: dependencies.nowIso() });
            context.ui.notify(reinforcement.created ? `Recorded explicit reinforcement for ${result.id}.` : `Identical reinforcement already exists for ${result.id} in this session.`, reinforcement.created ? "success" : "info");
          } catch (error) {
            context.ui.notify(`Memory reinforcement failed: ${error instanceof Error ? error.message : String(error)}`, "error");
          }
        } else if (result?.action === "deprecate") {
          const { loadLayerRecords, unsafeReplaceLayerRecords } = await import("../store");
          for (const layer of ["L1", "L2"] as const) {
            const layerRecords = loadLayerRecords(root, layer);
            if (!result.id || !layerRecords.some((record) => record.id === result.id)) continue;
            unsafeReplaceLayerRecords(root, layer, layerRecords.map((record) => record.id === result.id ? { ...record, status: "deprecated" as const, updated_at: new Date().toISOString().slice(0, 10) } : record));
            renderMemoryToDisk(root);
            syncFtsIndex(root, dependencies.getFtsIndex());
            await updateQmd();
            syncFtsIndex(root, dependencies.getFtsIndex());
            context.ui.notify(`Deprecated: ${result.id}`, "success");
            break;
          }
        }
      },
    },
  };
}
