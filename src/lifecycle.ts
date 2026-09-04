import { Type } from "@sinclair/typebox";
import { readFileSync, watch as fsWatch } from "node:fs";
import { join } from "node:path";
import { ensureMemoryDirs, resolveRoot } from "./paths";
import { appendDailyLog, todayString } from "./daily";
import { listCandidates } from "./inbox";
import { curateInbox } from "./curator";
import { applyPatch } from "./patch";
import { buildRetrievalContext, syncFtsIndex } from "./retriever";
import { setupQmd, updateQmd, runQmd, qmdSearchArgs, qmdCollectionName } from "./qmd";
import { runConsolidation, type ConsolidationResult, type ConsolidationRunner } from "./consolidator";
import { loadConfig } from "./config";
import { SessionStore, buildSessionSearchTools, buildSessionContextBlock, SESSION_SYNC_INTERVAL_MS } from "./session-search";
import { isChildProcess } from "./sessions/store";
import { createInboxReviewComponent, buildInboxNotification, shouldPromptForInbox, type InboxOverlayAction } from "./tui/InboxReviewOverlay";
import { maybeCorrectionSignal } from "./corrections";
import { actionsFromAgentMessages } from "./capture-activity";
import { processCaptureTurn } from "./capture-coordinator";
import { createPatchReviewComponent } from "./tui/PatchReviewPanel";
import { MemoryFtsIndex } from "./search/fts";
import { captureReinforcementLink, classifyRecordedToolOutcome, linkExplicitCorrectionToMemory } from "./reinforcement";
import { selectRelevantInquiries, renderInquiryInjectionBlock } from "./inquiries";
import { appendRuntimeEvent } from "./runtime-events";
import type { CaptureCandidate } from "./types";
import type { CommandUiContext } from "./commands/types";

export type LifecycleState = {
  root: string;
  ftsIndex: MemoryFtsIndex;
  sessionStore: SessionStore;
  sessionCwd: string;
  inboxOverlayShown: boolean;
  syncTimer: ReturnType<typeof setInterval> | null;
  syncDebounce: ReturnType<typeof setTimeout> | null;
  fsWatchers: ReturnType<typeof fsWatch>[];
  pendingUserMessages: string[];
  pendingAssistantMessages: string[];
  lastObservedModel: string | null;
};

type LifecycleApi = ConsolidationRunner & {
  registerTool(definition: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute(id: string, params: any): Promise<unknown> | unknown;
  }): void;
  sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" | "nextTurn" }): void;
};

type LifecycleDependencies = {
  nowIso(): string;
  extractText(content: unknown): string;
  extractMessageModel(message: any): string | null;
  resolveConsolidationModel(observedModel: string | null): { model: string | null; source: "env" | "current" | "pi-default" };
  syncFtsAfterPatch(patch: import("./types").MemoryPatch, applied: import("./types").MemoryPatch): void;
};

export function createLifecycleHandlers(pi: LifecycleApi, state: LifecycleState, dependencies: LifecycleDependencies) {
  return {
    sessionStart: async (_event: any, ctx: CommandUiContext) => {
      // Resolve state.root from cwd settings.json (localPath cascade)
      const newRoot = resolveRoot(ctx.cwd);
      if (newRoot !== state.root) {
        state.root = newRoot;
        state.ftsIndex.close();
        state.ftsIndex = new MemoryFtsIndex(state.root + "/search/memory-fts.db");
        state.sessionStore = new SessionStore(state.root);
        state.sessionStore.load();
      }
      // Sync FTS with current records on session start
      syncFtsIndex(state.root, state.ftsIndex);

      ensureMemoryDirs(state.root);
      state.sessionCwd = ctx.cwd ?? process.cwd();
      state.inboxOverlayShown = false;  // reset per session
      await setupQmd(state.root);

      // ── Session index sync ────────────────────────────────────────────
      try {
        const { added, updated } = state.sessionStore.sync();
        // Export markdown summaries for qmd semantic indexing
        const summariesDir = join(state.root, "sessions", "summaries");
        state.sessionStore.exportMarkdown(summariesDir);
        if (added + updated > 0 && ctx.hasUI) {
          ctx.ui.notify(`Session index: ${state.sessionStore.size()} sessions (${added} new, ${updated} updated)`, "info");
        }
      } catch { /* best-effort */ }

      // ── Session tools ─────────────────────────────────────────────────
      const sessionTools = buildSessionSearchTools(state.root, state.sessionStore);

      pi.registerTool({
        name: "session_search",
        label: "Session Search",
        description: "Search past pi sessions by content, decisions, project, or date. Use mode=semantic for conceptual queries (requires qmd embeddings).",
        parameters: Type.Object({
          query: Type.String(),
          project: Type.Optional(Type.String()),
          after: Type.Optional(Type.String({ description: "ISO date e.g. 2026-04-01" })),
          limit: Type.Optional(Type.Number()),
          include_archived: Type.Optional(Type.Boolean()),
          mode: Type.Optional(Type.Union([Type.Literal("keyword"), Type.Literal("semantic")], { description: "Search mode: keyword (default, instant) or semantic (requires qmd)" })),
        }),
        async execute(_id, params) {
          let text: string;
          if (params.mode === "semantic") {
            // Delegate to qmd over session summaries
            try {
              const result = await runQmd(qmdSearchArgs(params.query, "semantic", params.limit ?? 8), 10_000);
              text = result.stdout || "No semantic results. Ensure qmd embeddings are complete (run: qmd embed).";
            } catch {
              text = await sessionTools.session_search(params);
            }
          } else {
            text = await sessionTools.session_search(params);
          }
          return { content: [{ type: "text", text }], details: {} };
        },
      });

      pi.registerTool({
        name: "session_list",
        label: "Session List",
        description: "List past pi sessions filtered by project or date range.",
        parameters: Type.Object({
          project: Type.Optional(Type.String()),
          after: Type.Optional(Type.String()),
          before: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Number()),
          include_archived: Type.Optional(Type.Boolean()),
        }),
        async execute(_id, params) {
          return { content: [{ type: "text", text: await sessionTools.session_list(params) }], details: {} };
        },
      });

      pi.registerTool({
        name: "session_read",
        label: "Session Read",
        description: "Read the full conversation from a past session by ID or file path.",
        parameters: Type.Object({
          session: Type.String({ description: "Session UUID or file path" }),
          offset: Type.Optional(Type.Number()),
          limit: Type.Optional(Type.Number()),
        }),
        async execute(_id, params) {
          return { content: [{ type: "text", text: await sessionTools.session_read(params) }], details: {} };
        },
      });

      pi.registerTool({
        name: "session_decisions",
        label: "Session Decisions",
        description: "List #decision markers from recent sessions. Review past architectural and workflow decisions.",
        parameters: Type.Object({
          days: Type.Optional(Type.Number({ description: "Days back to look (default 7)" })),
          project: Type.Optional(Type.String()),
        }),
        async execute(_id, params) {
          return { content: [{ type: "text", text: await sessionTools.session_decisions(params) }], details: {} };
        },
      });

      // ── Periodic sync (like pi-session-search, 5min interval) ─────────
      if (!isChildProcess()) {
        // File-watch for instant detection of new session files
        try {
          const { homedir } = await import("node:os");
          const sessDirs = [join(homedir(), ".pi", "agent", "sessions")];
          for (const dir of sessDirs) {
            try {
              const watcher = fsWatch(dir, { persistent: false }, () => {
                if (state.syncDebounce) clearTimeout(state.syncDebounce);
                state.syncDebounce = setTimeout(() => {
                  try {
                    state.sessionStore.sync();
                    state.sessionStore.exportMarkdown(join(state.root, "sessions", "summaries"));
                  } catch { /* ignore */ }
                }, 2000);
              });
              state.fsWatchers.push(watcher);
            } catch { /* fs.watch may not be available for this dir */ }
          }
        } catch { /* dynamic import may fail in some envs */ }

        // Fallback periodic sync every 5 minutes
        state.syncTimer = setInterval(() => {
          try {
            const { added, updated } = state.sessionStore.sync();
            if (added + updated > 0) state.sessionStore.exportMarkdown(join(state.root, "sessions", "summaries"));
          } catch { /* ignore */ }
        }, SESSION_SYNC_INTERVAL_MS);
      }

      if (ctx.hasUI) ctx.ui.notify("Persistent Intelligence ready", "info");

      // ── Version update check ──────────────────────────────────────────
      // Check npm registry for a newer version once per session, non-blocking.
      // Skipped in subagents and headless mode.
      if (ctx.hasUI && !isChildProcess()) {
        (async () => {
          try {
            const { readFileSync } = await import("node:fs");
            const { join: pathJoin } = await import("node:path");
            const pkgPath = pathJoin(import.meta.dir, "package.json");
            const currentVersion: string = (JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string }).version;
            const response = await fetch(`https://registry.npmjs.org/pi-persistent-intelligence/latest`, {
              signal: AbortSignal.timeout(8_000),
            });
            if (!response.ok) return;
            const data = await response.json() as { version?: string };
            const latestVersion = data.version;
            if (typeof latestVersion !== "string" || !latestVersion.trim()) return;

            // Simple semver comparison: split on . and compare numerically
            const parseVer = (v: string) => v.replace(/^v/, "").split(".").map(Number);
            const current = parseVer(currentVersion);
            const latest = parseVer(latestVersion);
            const isNewer = latest[0] > current[0] || (latest[0] === current[0] && latest[1] > current[1]) || (latest[0] === current[0] && latest[1] === current[1] && latest[2] > current[2]);

            if (isNewer) {
              ctx.ui.notify(
                `pi-persistent-intelligence ${latestVersion} is available (you have ${currentVersion}).\nRun: pi install npm:pi-persistent-intelligence`,
                "warning",
              );
            }
          } catch { /* best-effort: network unavailable, offline, etc. */ }
        })();
      }
    },
    beforeAgentStart: async (event: any, ctx: CommandUiContext) => {
      // ── Inbox review — first turn only ─────────────────────────────────────
      // Step 1: InboxReviewOverlay summary — ✓/~ badges, [A]/[R]/[S] actions.
      //         Uses the same theme color mappings as PatchReviewPanel (via
      //         themeFromInbox) for visual consistency across the extension.
      // Step 2: If user picks [R] → open PatchReviewPanel for per-op selection
      //         (identical to /curate-memory propose mode).
      // minEvidenceCount: 1 — show all candidates for human review; evidence
      // gate (≥2) still enforced by the curator at apply time.
      if (!state.inboxOverlayShown && ctx.hasUI && ctx.ui.custom) {
        state.inboxOverlayShown = true;
        const cfg = loadConfig(state.root);
        const threshold = cfg.curator.autoCurateHighThreshold ?? 0.85;
        const promptThreshold = cfg.curator.inboxPromptThreshold ?? 3;
        const pending = listCandidates(state.root).filter((c) => c.status === "new");

        if (shouldPromptForInbox(pending, { batchThreshold: promptThreshold, singletonDirectReview: cfg.capture.singletonDirectReview })) {
          const autoEligible = pending.filter((c) => (c.confidence ?? 0) >= threshold);
          const vaultPath = cfg.vault.path ?? process.env.PI_VAULT_PATH;

          try {
            // ── Step 1: summary overlay ──────────────────────────────────
            const action = await ctx.ui.custom<InboxOverlayAction>(
              (tui, theme, _kb, done) =>
                createInboxReviewComponent(
                  { candidates: pending, autoEligibleCount: autoEligible.length, highThreshold: threshold },
                  done,
                  tui as { requestRender(): void },
                  theme,
                ),
            );

            if (action === "approve") {
              // Apply ops for candidates meeting confidence threshold.
              // Intentionally does not filter on default_selected -- pressing 'a' is an
              // explicit user approval for all eligible ops, including review_only classified
              // ones that would otherwise stay in inbox indefinitely.
              const patch = curateInbox(state.root, { now: dependencies.nowIso(), mode: "auto", vaultPath, minEvidenceCount: 1 });
              const eligibleIds = patch.ops
                .filter((op) => op.risk !== "high" &&
                  (op.record?.confidence ?? op.to_record?.confidence ?? 0) >= threshold)
                .map((op) => op.op_id);
              if (eligibleIds.length > 0) {
                const applied = applyPatch(state.root, patch, { selectedOpIds: eligibleIds, now: dependencies.nowIso() });
                await updateQmd();
                dependencies.syncFtsAfterPatch(patch, applied);
                ctx.ui.notify(`✓ Applied ${eligibleIds.length} memory op(s).`, "success");
              }

            } else if (action === "review") {
              // Chain a second ctx.ui.custom() call to show PatchReviewPanel.
              // The first ctx.ui.custom() (inbox overlay) must fully resolve before
              // calling the second -- they are sequential, not concurrent.
              // We are still inside before_agent_start at this point.
              if (ctx.ui.custom) {
                try {
                  const cfg2 = loadConfig(state.root);
                  const vaultPath2 = cfg2.vault.path ?? process.env.PI_VAULT_PATH;
                  const reviewPatch = curateInbox(state.root, { now: dependencies.nowIso(), mode: "propose", vaultPath: vaultPath2, minEvidenceCount: 1 });
                  if (reviewPatch.ops.length > 0) {
                    const selectedIds = await ctx.ui.custom<string[] | null>(
                      (tui, theme, _kb, done) =>
                        createPatchReviewComponent(reviewPatch, done, tui as any, undefined, theme),
                    );
                    if (selectedIds && selectedIds.length > 0) {
                      const applied = applyPatch(state.root, reviewPatch, { selectedOpIds: selectedIds, now: dependencies.nowIso() });
                      await updateQmd();
                      dependencies.syncFtsAfterPatch(reviewPatch, applied);
                      ctx.ui.notify(`✓ Applied ${selectedIds.length} memory op(s).`, "success");
                    }
                  } else {
                    ctx.ui.notify("No candidates meet curation thresholds.", "info");
                  }
                } catch {
                  ctx.ui.notify("Type /curate-memory to review pending candidates.", "info");
                }
              } else {
                ctx.ui.notify("Type /curate-memory to review pending candidates.", "info");
              }
            }
            // "skip" / null — candidates stay in inbox, session continues
          } catch {
            ctx.ui.notify(buildInboxNotification(pending, autoEligible.length), "info");
          }
        }
      }

      // ── Context injection ───────────────────────────────────────────────
      const context = await buildRetrievalContext(state.root, {
        prompt: event.prompt ?? "",
        today: todayString(),
        useQmd: true,
        qmdCollection: qmdCollectionName,
        ftsIndex: state.ftsIndex,
        cwd: ctx.cwd ?? state.sessionCwd,
        threadId: (event as { session_id?: string; sessionId?: string }).session_id ?? (event as { sessionId?: string }).sessionId ?? "current-session",
      });
      const sessionBlock = buildSessionContextBlock(state.sessionStore, todayString());
      const inquiries = selectRelevantInquiries(state.root, {
        profile_id: context.processorTraces.length > 0 ? (context.selectedMemory[0]?.profile_id ?? undefined) : undefined,
        current_message: event.prompt ?? "",
        tags: [],
      });
      const inquiryBlock = renderInquiryInjectionBlock(inquiries);
      const combined = [sessionBlock ? `${context.markdown}\n\n## Today's Sessions\n${sessionBlock}` : context.markdown, inquiryBlock].filter(Boolean).join("\n\n");

      if (!combined.trim()) return;
      return {
        message: {
          customType: "pi-persistent-intelligence-context",
          content: combined,
          display: false,
        },
      };
    },
    agentEnd: async (event: any) => {
      let sawObservableOutcome = false;
      const eventMessages = (event.messages as any[]) ?? [];
      const captureActions = actionsFromAgentMessages(eventMessages, state.sessionCwd);
      const captureSessionId = String((event as any).session_id ?? (event as any).sessionId ?? "current-session");
      for (const [messageIndex, msg] of eventMessages.entries()) {
        if (msg.role === "user" && !msg.customType) {
          const text = dependencies.extractText(msg.content);
          if (text.trim()) {
            state.pendingUserMessages.push(text);
            if (state.pendingUserMessages.length > 60) state.pendingUserMessages.shift();

            const messageTurnId = String(msg.id ?? msg.messageId ?? msg.timestamp ?? (event as any).turn_id ?? (event as any).turnId ?? (event as any).id ?? `user-${messageIndex}`);
            processCaptureTurn(state.root, {
              session_id: captureSessionId,
              turn_id: messageTurnId,
              message: text,
              launch_cwd: state.sessionCwd,
              actions: captureActions,
              now: dependencies.nowIso(),
            });

            if (maybeCorrectionSignal(text)) {
              try {
                const selected = JSON.parse((await import("node:fs")).readFileSync(ensureMemoryDirs(state.root).runtime.selected, "utf-8")) as import("./types").MemoryRecord[];
                linkExplicitCorrectionToMemory(state.root, text, selected, { thread_id: captureSessionId, now: dependencies.nowIso() });
              } catch { /* best-effort reinforcement linking */ }
            }
          }
        } else if (msg.role === "toolResult" || msg.role === "tool") {
          const toolName = String(msg.toolName ?? msg.name ?? msg.tool_name ?? "");
          const details = msg.details ?? {};
          const observableCommand = String(msg.input?.command ?? details.command ?? "");
          const observableLabel = `${toolName} ${observableCommand}`;
          if (/\b(test|typecheck|lint|check|build|playwright|vitest|tsc|cargo)\b/i.test(observableLabel)) {
            const recordedOutcome = classifyRecordedToolOutcome({ ...details, isError: msg.isError === true || details.isError === true });
            if (recordedOutcome !== "unknown") {
              sawObservableOutcome = true;
              try {
                const selected = JSON.parse((await import("node:fs")).readFileSync(ensureMemoryDirs(state.root).runtime.selected, "utf-8")) as import("./types").MemoryRecord[];
                captureReinforcementLink(state.root, {
                  selected_memory: selected,
                  session_id: captureSessionId,
                  observable_outcome: { kind: /\b(test|playwright|vitest)\b/i.test(observableLabel) ? "test" : "tool", success: recordedOutcome === "success", tool_name: toolName, command: observableCommand },
                  neutral_exposure_enabled: loadConfig(state.root).reinforcement.neutralExposureEnabled,
                  now: dependencies.nowIso(),
                });
              } catch { /* observable reinforcement is best-effort and never mutates memory */ }
            }
          }
        } else if (msg.role === "assistant") {
          const observed = dependencies.extractMessageModel(msg);
          if (observed) state.lastObservedModel = observed;
          const text = dependencies.extractText(msg.content);
          if (text.trim()) {
            state.pendingAssistantMessages.push(text);
            if (state.pendingAssistantMessages.length > 60) state.pendingAssistantMessages.shift();
          }
        }
      }
      if (!sawObservableOutcome && loadConfig(state.root).reinforcement.neutralExposureEnabled) {
        try {
          const selected = JSON.parse((await import("node:fs")).readFileSync(ensureMemoryDirs(state.root).runtime.selected, "utf-8")) as import("./types").MemoryRecord[];
          captureReinforcementLink(state.root, {
            selected_memory: selected,
            session_id: "current-session",
            neutral_exposure_enabled: true,
            now: dependencies.nowIso(),
          });
        } catch { /* neutral exposure is optional and best-effort */ }
      }
    },
    sessionShutdown: async (event: any) => {
      // Clear all timers and watchers
      if (state.syncTimer) { clearInterval(state.syncTimer); state.syncTimer = null; }
      if (state.syncDebounce) { clearTimeout(state.syncDebounce); state.syncDebounce = null; }
      for (const w of state.fsWatchers) { try { w.close(); } catch { /* ignore */ } }
      state.fsWatchers.length = 0;

      if ((event as { reason?: string }).reason === "reload") return;

      appendDailyLog(state.root, todayString(), `<!-- ${dependencies.nowIso()} -->\n## Session ended\n- Persistent Intelligence captured session end marker.`);

      // LLM consolidation — extracts candidates to inbox, deduped by Jaccard
      const cfg = loadConfig(state.root);
      const consolidationModel = dependencies.resolveConsolidationModel(state.lastObservedModel);
      let consolidationResult: ConsolidationResult | null = null;

      if (state.pendingUserMessages.length >= 3) {
        consolidationResult = await runConsolidation(
          state.root, state.pendingUserMessages, state.pendingAssistantMessages,
          todayString(), state.sessionCwd, pi, consolidationModel.model,
        );
        if (consolidationResult.status === "failed") {
          const modelLabel = consolidationModel.model ? `${consolidationModel.model} (${consolidationModel.source})` : "Pi CLI default";
          const reason = consolidationResult.failure_reason ?? "unknown failure";
          appendRuntimeEvent(state.root, { type: "warn", severity: "medium", component: "consolidation", message: `session consolidation failed using ${modelLabel}: ${reason}` });
          appendDailyLog(
            state.root, todayString(),
            `<!-- ${dependencies.nowIso()} -->\n## Consolidation skipped\n- Persistent Intelligence could not run session consolidation using ${modelLabel}: ${reason}`,
          );
        }
      }

      // ── Tiered auto-curation ──────────────────────────────────────────
      // Runs after consolidation so freshly extracted candidates are eligible.
      //
      // "off"          — never auto-curate; user runs /curate-memory manually
      // "high-only"    — auto-apply only ops with confidence >= threshold AND
      //                  not L1 / supersede (default_selected=true, risk=low)
      // "all-eligible" — auto-apply every default_selected non-high-risk op
      //
      // L1 writes and supersede ops are NEVER auto-applied regardless of mode
      // because they are marked risk="high" / default_selected=false by the curator.
      const autoCurate = cfg.curator.autoCurate ?? "high-only";
      const highThreshold = cfg.curator.autoCurateHighThreshold ?? 0.85;

      if (autoCurate !== "off") {
        try {
          const vaultPath = cfg.vault.path ?? process.env.PI_VAULT_PATH;
          const patch = curateInbox(state.root, { now: dependencies.nowIso(), mode: "auto", vaultPath, governanceMode: cfg.governance.mode });

          if (patch.ops.length > 0) {
            // Filter ops to apply based on the autoCurate tier
            const eligibleIds = patch.ops
              .filter((op) => {
                if (!op.default_selected || op.risk === "high") return false;
                if (autoCurate === "high-only") {
                  const confidence = op.record?.confidence ?? op.to_record?.confidence ?? 0;
                  return confidence >= highThreshold;
                }
                return true; // "all-eligible"
              })
              .map((op) => op.op_id);

            if (eligibleIds.length > 0) {
              const applied = applyPatch(state.root, patch, { selectedOpIds: eligibleIds, now: dependencies.nowIso() });
              dependencies.syncFtsAfterPatch(patch, applied); // F-03 fix: sync immediately after auto-curation patch plus post-sync diagnostics
              const skipped = patch.ops.length - eligibleIds.length;
              appendDailyLog(
                state.root, todayString(),
                `<!-- ${dependencies.nowIso()} -->\n## Auto-curation\n- Applied ${applied.applied_ops.length} L2 op(s) automatically (${skipped} held for /curate-memory review).`,
              );
            }
          }
        } catch { /* best-effort — never crash shutdown */ }
      }

      // Log consolidation result (after curation, so it appears below auto-curation note)
      if (consolidationResult && consolidationResult.candidates_added > 0) {
        const held = listCandidates(state.root).filter((c) => c.status === "new").length;
        if (held > 0) {
          appendDailyLog(
            state.root, todayString(),
            `<!-- ${dependencies.nowIso()} -->\n## Consolidation\n- ${consolidationResult.candidates_added} candidate(s) in inbox (${consolidationResult.candidates_skipped_dedup} deduped). ${held} await /curate-memory review.`,
          );
        }
      }

      state.pendingUserMessages.length = 0;
      state.pendingAssistantMessages.length = 0;
      state.lastObservedModel = null;

      await updateQmd();
        syncFtsIndex(state.root, state.ftsIndex);
    },
  };
}
