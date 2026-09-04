import { Type } from "@sinclair/typebox";
import { watch as fsWatch } from "node:fs";
import { createBrowserCommands } from "./src/commands/browser";
import { createCaptureCommands } from "./src/commands/capture";
import { createDiagnosticCommands } from "./src/commands/diagnostics";
import { createGovernedRepairCommands } from "./src/commands/governed-repairs";
import { createInteroperabilityCommands } from "./src/commands/interoperability";
import { createLearningCommands } from "./src/commands/learning";
import { createMaintenanceCommands } from "./src/commands/maintenance";
import { createQualityCommands } from "./src/commands/quality";
import { createReinforcementCommands } from "./src/commands/reinforcement";
import { createSessionCommands } from "./src/commands/sessions";
import type { CommandDefinition, CommandUiContext } from "./src/commands/types";
import { createLifecycleHandlers, type LifecycleState } from "./src/lifecycle";

type ToolResult = { content: Array<{ type: "text"; text: string }>; details: unknown };
type UiContext = CommandUiContext;
type ExecResult = { stdout: string; stderr: string; code: number; killed: boolean };
type ExtensionAPI = {
  on(name: string, handler: (event: any, ctx: UiContext) => Promise<any> | any): void;
  exec(command: string, args: string[], options?: { timeout?: number; cwd?: string; signal?: AbortSignal }): Promise<ExecResult>;
  getAllTools(): Array<{ name: string }>;
  sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" | "nextTurn" }): void;
  registerTool(definition: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute(id: string, params: any): Promise<ToolResult> | ToolResult;
  }): void;
  registerCommand(name: string, definition: CommandDefinition): void;
};

import { ensureMemoryDirs, resolveRoot } from "./src/paths";
import { appendDailyLog, readDailyLog, todayString } from "./src/daily";
import { addScratchpadItem, clearDoneScratchpadItems, listScratchpadItems, markScratchpadDone, markScratchpadUndone } from "./src/scratchpad";
import { appendCandidate, listCandidates, shouldPersistWorthDecision, withMemoryWorth } from "./src/inbox";
import { syncFtsIndex } from "./src/retriever";
import { renderMemoryToDisk } from "./src/render";
import { updateQmd, runQmd, qmdSearchArgs, type MemorySearchMode } from "./src/qmd";
import { SessionStore } from "./src/session-search";
import { MemoryFtsIndex } from "./src/search/fts";
import { runFtsAwarePostMutationChecksAfterSync } from "./src/post-mutation-checks";
import { buildCandidateTrustMetadata } from "./src/trust";
import { scanSecrets, shouldBlockPersistence, redactSecrets } from "./src/secret-scanner";
import type { CaptureCandidate } from "./src/types";

function nowIso(): string { return new Date().toISOString(); }
function shortId(prefix: string): string {
  return `${prefix}_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 6)}`;
}
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as any[]).filter((b) => b.type === "text").map((b) => b.text as string).join(" ");
  }
  return "";
}

function extractMessageModel(message: any): string | null {
  const provider = typeof message?.provider === "string" ? message.provider.trim() : "";
  const model = typeof message?.model === "string" ? message.model.trim() : "";
  if (provider && model) return `${provider}/${model}`;
  return model || null;
}

function resolveConsolidationModel(observedModel: string | null): { model: string | null; source: "env" | "current" | "pi-default" } {
  const preferred = process.env.PI_MEMORY_CONSOLIDATION_MODEL?.trim();
  if (preferred) return { model: preferred, source: "env" };
  if (observedModel?.trim()) return { model: observedModel.trim(), source: "current" };
  return { model: null, source: "pi-default" };
}

export default function persistentIntelligence(pi: ExtensionAPI) {
  // root is resolved at session_start based on cwd — mutable for localPath support
  let root = resolveRoot();
  ensureMemoryDirs(root);

  const pendingUserMessages: string[] = [];
  const pendingAssistantMessages: string[] = [];
  let lastObservedModel: string | null = null;
  let sessionCwd = process.cwd();

  // FTS index — synced after every canonical mutation
  let ftsIndex = new MemoryFtsIndex(root + "/search/memory-fts.db");
  syncFtsIndex(root, ftsIndex);

  function syncFtsAfterPatch(patch: import("./src/types").MemoryPatch, applied: import("./src/types").MemoryPatch): void {
    syncFtsIndex(root, ftsIndex);
    const appliedOps = patch.ops.filter((op) => applied.applied_ops.includes(op.op_id));
    runFtsAwarePostMutationChecksAfterSync({ root, patchId: patch.patch_id, ops: appliedOps, ftsIndex });
  }

  // Session store — recreated at session_start if root changes
  let sessionStore = new SessionStore(root);
  sessionStore.load();

  // inboxOverlayShown: reset per session so the prompt shows once each time pi opens
  let inboxOverlayShown = false;
  let syncTimer: ReturnType<typeof setInterval> | null = null;
  let syncDebounce: ReturnType<typeof setTimeout> | null = null;
  const fsWatchers: ReturnType<typeof fsWatch>[] = [];
  const commandHistory: Array<{ id: string; command: string; created_at: string; summary: string; output: string }> = [];
  function rememberCommand(command: string, output: string, summary = output.split(/\r?\n/)[0] ?? ""): void {
    commandHistory.unshift({ id: shortId("cmd"), command, created_at: nowIso(), summary: summary.slice(0, 160), output });
    commandHistory.splice(25);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  const lifecycleState: LifecycleState = {
    get root() { return root; }, set root(value) { root = value; },
    get ftsIndex() { return ftsIndex; }, set ftsIndex(value) { ftsIndex = value; },
    get sessionStore() { return sessionStore; }, set sessionStore(value) { sessionStore = value; },
    get sessionCwd() { return sessionCwd; }, set sessionCwd(value) { sessionCwd = value; },
    get inboxOverlayShown() { return inboxOverlayShown; }, set inboxOverlayShown(value) { inboxOverlayShown = value; },
    get syncTimer() { return syncTimer; }, set syncTimer(value) { syncTimer = value; },
    get syncDebounce() { return syncDebounce; }, set syncDebounce(value) { syncDebounce = value; },
    fsWatchers, pendingUserMessages, pendingAssistantMessages,
    get lastObservedModel() { return lastObservedModel; }, set lastObservedModel(value) { lastObservedModel = value; },
  };
  const lifecycleHandlers = createLifecycleHandlers(pi, lifecycleState, {
    nowIso, extractText, extractMessageModel, resolveConsolidationModel, syncFtsAfterPatch,
  });
  pi.on("session_start", lifecycleHandlers.sessionStart);
  pi.on("before_agent_start", lifecycleHandlers.beforeAgentStart);
  pi.on("agent_end", lifecycleHandlers.agentEnd);
  pi.on("session_shutdown", lifecycleHandlers.sessionShutdown);

  // ─── Core memory tools ───────────────────────────────────────────────

  pi.registerTool({
    name: "memory_write",
    label: "Memory Write",
    description: "Write to PI memory. Daily writes append directly; long_term writes become inbox candidates for curation.",
    parameters: Type.Object({
      target: Type.Union([Type.Literal("daily"), Type.Literal("long_term")]),
      content: Type.String(),
      tags: Type.Optional(Type.Array(Type.String())),
      confidence: Type.Optional(Type.Number()),
    }),
    async execute(_id, params) {
      if (params.target === "daily") {
        appendDailyLog(root, todayString(), params.content);
        await updateQmd();
      syncFtsIndex(root, ftsIndex);
        return { content: [{ type: "text", text: `Appended to daily log ${todayString()}.` }], details: {} };
      }
      const secretScan = scanSecrets(params.content);
      if (shouldBlockPersistence(secretScan)) {
        return { content: [{ type: "text", text: "Blocked long-term memory capture: high-confidence secret-like content detected. Nothing was persisted." }], details: { blocked: true, findings: secretScan.findings.map((f) => ({ kind: f.kind, confidence: f.confidence, preview: f.preview })) } };
      }
      let candidate: CaptureCandidate = {
        id: shortId("cap"),
        created_at: nowIso(),
        source: { type: "manual", ref: `daily/${todayString()}.md`, cwd: process.cwd() },
        text: redactSecrets(params.content),
        tags: params.tags ?? [],
        evidence_refs: [`daily/${todayString()}.md`],
        confidence: params.confidence ?? 0.7,
        status: "new" as const,
        ...buildCandidateTrustMetadata("direct_user_instruction", "long_term"),
      };
      candidate = withMemoryWorth(candidate, listCandidates(root).map((c) => c.text));
      if (candidate.worth_decision === "reject") {
        return { content: [{ type: "text", text: `Memory-worth scoring rejected durable capture (${candidate.worth_reasons?.join(", ") || "low worth"}). Nothing was persisted.` }], details: candidate };
      }
      if (candidate.worth_decision === "daily_only") {
        appendDailyLog(root, todayString(), `<!-- ${nowIso()} -->\n## Memory-worth daily-only\n- ${candidate.text}`);
        return { content: [{ type: "text", text: `Memory-worth scoring routed this to daily log only (${candidate.worth_score}).` }], details: candidate };
      }
      if (!shouldPersistWorthDecision(candidate.worth_decision ?? "candidate")) {
        return { content: [{ type: "text", text: "Memory-worth scoring did not allow inbox persistence." }], details: candidate };
      }
      appendCandidate(root, candidate);
      return { content: [{ type: "text", text: `Captured long-term memory candidate ${candidate.id}; worth=${candidate.worth_decision}/${candidate.worth_score}; run /curate-memory to review.` }], details: candidate };
    },
  });

  pi.registerTool({
    name: "memory_read",
    label: "Memory Read",
    description: "Read PI memory targets.",
    parameters: Type.Object({ target: Type.Union([Type.Literal("long_term"), Type.Literal("daily"), Type.Literal("scratchpad"), Type.Literal("inbox")]) }),
    async execute(_id, params) {
      let text = "";
      if (params.target === "long_term") text = renderMemoryToDisk(root);
      if (params.target === "daily") text = readDailyLog(root, todayString());
      if (params.target === "scratchpad") text = listScratchpadItems(root).map((item) => `- [${item.done ? "x" : " "}] ${item.text}`).join("\n");
      if (params.target === "inbox") text = JSON.stringify(listCandidates(root), null, 2);
      return { content: [{ type: "text", text: text || "empty" }], details: {} };
    },
  });

  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description: "Search PI memory. mode=keyword (default, uses built-in FTS — instant, no external deps), mode=semantic (qmd embeddings), mode=deep (qmd hybrid reranking).",
    parameters: Type.Object({
      query: Type.String(),
      mode: Type.Optional(Type.Union([Type.Literal("keyword"), Type.Literal("semantic"), Type.Literal("deep")])),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(_id, params) {
      const limit = params.limit ?? 8;
      const mode = (params.mode ?? "keyword") as MemorySearchMode;

      // keyword mode: use built-in FTS (no external deps, instant)
      if (mode === "keyword" && ftsIndex.isAvailable) {
        const results = ftsIndex.search(params.query, limit);
        if (results.length > 0) {
          const lines = results.map((r) =>
            `- ${r.id} [${r.layer}, conf ${r.confidence.toFixed(2)}${r.ruleType ? ", " + r.ruleType : ""}] ${r.statement}`
          );
          return { content: [{ type: "text", text: lines.join("\n") }], details: { results } };
        }
        return { content: [{ type: "text", text: "No results." }], details: {} };
      }

      // semantic / deep: delegate to qmd
      try {
        const result = await runQmd(qmdSearchArgs(params.query, mode, limit), 60_000);
        return { content: [{ type: "text", text: result.stdout || "No results." }], details: {} };
      } catch {
        return { content: [{ type: "text", text: "qmd unavailable. Try mode=keyword." }], details: {} };
      }
    },
  });

  pi.registerTool({
    name: "scratchpad",
    label: "Scratchpad",
    description: "Manage PI scratchpad checklist.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("add"), Type.Literal("done"), Type.Literal("undo"), Type.Literal("clear_done"), Type.Literal("list")]),
      text: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      if (params.action === "add") addScratchpadItem(root, params.text ?? "");
      if (params.action === "done") markScratchpadDone(root, params.text ?? "");
      if (params.action === "undo") markScratchpadUndone(root, params.text ?? "");
      if (params.action === "clear_done") clearDoneScratchpadItems(root);
      const items = listScratchpadItems(root);
      return { content: [{ type: "text", text: items.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`).join("\n") || "empty" }], details: {} };
    },
  });

  // ─── Commands ────────────────────────────────────────────────────────

  const browserCommands = createBrowserCommands({ getRoot: () => root, getCommandHistory: () => commandHistory, getFtsIndex: () => ftsIndex, nowIso, rememberCommand, syncFtsAfterPatch });
  pi.registerCommand("memory-history", browserCommands.memoryHistory);

  const diagnosticCommands = createDiagnosticCommands({
    getRoot: () => root,
    getSessionCount: () => sessionStore.size(),
    getObservedModel: () => lastObservedModel,
    nowIso,
    resolveConsolidationModel,
    rememberCommand,
  });
  pi.registerCommand("memory-doctor", diagnosticCommands.memoryDoctor);
  pi.registerCommand("memory-health-audit", diagnosticCommands.memoryHealthAudit);
  pi.registerCommand("memory-diagnostics", diagnosticCommands.memoryDiagnostics);

  const governedRepairCommands = createGovernedRepairCommands({ getRoot: () => root, nowIso });
  pi.registerCommand("memory-store-integrity", governedRepairCommands.memoryStoreIntegrity);
  pi.registerCommand("memory-key-repair", governedRepairCommands.memoryKeyRepair);

  const interoperabilityCommands = createInteroperabilityCommands({ getRoot: () => root, getSessionCwd: () => sessionCwd });
  pi.registerCommand("memory-export", interoperabilityCommands.memoryExport);
  pi.registerCommand("memory-import", interoperabilityCommands.memoryImport);
  pi.registerCommand("memory-reconcile", interoperabilityCommands.memoryReconcile);
  pi.registerCommand("memory-governance", interoperabilityCommands.memoryGovernance);

  const qualityCommands = createQualityCommands({ getRoot: () => root, getSessionCwd: () => sessionCwd, nowIso, rememberCommand });
  pi.registerCommand("memory-recall-xray", qualityCommands.memoryRecallXray);

  const reinforcementCommands = createReinforcementCommands({ getRoot: () => root, nowIso });
  pi.registerCommand("memory-reinforce", reinforcementCommands.memoryReinforce);

  pi.registerCommand("memory-inquiries", reinforcementCommands.memoryInquiries);

  const captureCommands = createCaptureCommands({ getRoot: () => root, getSessionCwd: () => sessionCwd, nowIso, rememberCommand });
  pi.registerCommand("memory-evidence", captureCommands.memoryEvidence);

  pi.registerCommand("memory-background", qualityCommands.memoryBackground);

  pi.registerCommand("memory-recall-effectiveness", qualityCommands.memoryRecallEffectiveness);

  pi.registerCommand("memory-capture-backfill", captureCommands.memoryCaptureBackfill);

  pi.registerCommand("memory-capture-audit", captureCommands.memoryCaptureAudit);

  pi.registerCommand("memory-capture-quality", captureCommands.memoryCaptureQuality);

  pi.registerCommand("memory-store-quality", qualityCommands.memoryStoreQuality);

  pi.registerCommand("memory-quality", qualityCommands.memoryQuality);

  pi.registerCommand("memory-relationship-quality", qualityCommands.memoryRelationshipQuality);

  pi.registerCommand("memory-worth", qualityCommands.memoryWorth);

  pi.registerCommand("memory-graph", qualityCommands.memoryGraph);

  pi.registerCommand("memory-timeline", qualityCommands.memoryTimeline);

  const learningCommands = createLearningCommands({ getRoot: () => root, nowIso });
  pi.registerCommand("procedure-candidates", learningCommands.procedureCandidates);

  pi.registerCommand("memory-skill", learningCommands.memorySkill);

  pi.registerCommand("memory-failures", learningCommands.memoryFailures);

  pi.registerCommand("memory-inbox", browserCommands.memoryInbox);

  pi.registerCommand("memory-learnings", browserCommands.memoryLearnings);

  const maintenanceCommands = createMaintenanceCommands({
    getRoot: () => root, getSessionCwd: () => sessionCwd, getFtsIndex: () => ftsIndex,
    getPendingUserMessages: () => pendingUserMessages, getPendingAssistantMessages: () => pendingAssistantMessages,
    getObservedModel: () => lastObservedModel, getRunner: () => pi, nowIso, rememberCommand, syncFtsAfterPatch, resolveConsolidationModel,
  });
  pi.registerCommand("curate-memory", maintenanceCommands.curateMemory);

  pi.registerCommand("maintain-memory", maintenanceCommands.maintainMemory);

  pi.registerCommand("memory-simulate-patch", maintenanceCommands.memorySimulatePatch);

  pi.registerCommand("memory-patches", maintenanceCommands.memoryPatches);

  pi.registerCommand("apply-memory-patch", maintenanceCommands.applyMemoryPatch);

  pi.registerCommand("meta-consolidation", maintenanceCommands.metaConsolidation);

  pi.registerCommand("memory-handoff", maintenanceCommands.memoryHandoff);

  pi.registerCommand("render-memory", maintenanceCommands.renderMemory);

  pi.registerCommand("consolidate-memory", maintenanceCommands.consolidateMemory);

  const sessionCommands = createSessionCommands({ getRoot: () => root, getSessionStore: () => sessionStore, getFtsIndex: () => ftsIndex });
  pi.registerCommand("session-sync", sessionCommands.sessionSync);

  pi.registerCommand("session-reindex", sessionCommands.sessionReindex);

  pi.registerCommand("setup-session-search", sessionCommands.setupSessionSearch);


}

export { applyPatchAndSync } from "./src/patch-sync";
export { exportToPiGovernanceBundle, importFromPiGovernanceBundle, runPiGovernanceDoctor } from "./src/pi-governance-compat";
export type { PiGovernanceBundle, PiGovernanceExportOptions, PiGovernanceImportOptions, PiGovernanceImportResult, PiGovernanceDoctorReport } from "./src/pi-governance-compat";
export { reconcilePiGovernanceBundles } from "./src/pi-governance-reconciliation";
export type { ReconciliationReport, ReconciliationSection } from "./src/pi-governance-reconciliation";
