import { Type } from "@sinclair/typebox";
import { watch as fsWatch } from "node:fs";
import { join } from "node:path";

type ToolResult = { content: Array<{ type: "text"; text: string }>; details: unknown };
type UiContext = {
  hasUI?: boolean;
  cwd: string;
  ui: {
    notify(message: string, kind?: string): void;
    setStatus?(id: string, msg: string): void;
    // ctx.ui.custom() — shows a TUI component; overlay:true makes it a floating modal
    custom?<T>(factory: (tui: unknown, theme: unknown, kb: unknown, done: (val: T) => void) => unknown, opts?: { overlay?: boolean; overlayOptions?: { anchor?: string; width?: number; maxHeight?: number } }): Promise<T>;
  };
};
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
  registerCommand(name: string, definition: { description: string; handler(args: string, ctx: UiContext): Promise<void> | void }): void;
};

import { ensureMemoryDirs, resolveRoot } from "./src/paths";
import { appendDailyLog, readDailyLog, todayString } from "./src/daily";
import { addScratchpadItem, clearDoneScratchpadItems, listScratchpadItems, markScratchpadDone, markScratchpadUndone } from "./src/scratchpad";
import { appendCandidate, listCandidates, shouldPersistWorthDecision, withMemoryWorth } from "./src/inbox";
import { curateInbox } from "./src/curator";
import { maintainMemory } from "./src/maintainer";
import { generateMaintenanceRecommendations, buildStabilityPatchFromRecommendations, generateMaintenanceReport } from "./src/maintenance";
import { readReinforcementEventsForMemory, summarizeReinforcement } from "./src/reinforcement";
import { runMetaConsolidation, generateHandoffSnapshot, generateGoalHandoffSnapshot, DEFAULT_META_CONSOLIDATION_CONFIG } from "./src/meta-consolidation";
import { runMemoryDiagnostics, renderDiagnosticsReport, saveDiagnosticsReport } from "./src/diagnostics";
import { applyPatch } from "./src/patch";
import { buildRetrievalContext, syncFtsIndex } from "./src/retriever";
import { renderMemoryToDisk } from "./src/render";
import { setupQmd, updateQmd, runQmd, qmdSearchArgs, qmdCollectionName, type MemorySearchMode } from "./src/qmd";
import { runConsolidation } from "./src/consolidator";
import { loadConfig } from "./src/config";
import { SessionStore, buildSessionSearchTools, buildSessionContextBlock, SESSION_SYNC_INTERVAL_MS } from "./src/session-search";
import { isChildProcess } from "./src/sessions/store";
import { createInboxReviewComponent, buildInboxNotification, type InboxOverlayAction } from "./src/tui/InboxReviewOverlay";
import { maybeCorrectionSignal, extractCorrectionCandidate } from "./src/corrections";
import { createPatchReviewComponent } from "./src/tui/PatchReviewPanel";
import { createMemoryListComponent } from "./src/tui/MemoryListPanel";
import { MemoryFtsIndex } from "./src/search/fts";
import { loadActiveRecords } from "./src/store";
import { buildCandidateTrustMetadata } from "./src/trust";
import { linkExplicitCorrectionToMemory } from "./src/reinforcement";
import { selectRelevantInquiries, renderInquiryInjectionBlock } from "./src/inquiries";
import { scanSecrets, shouldBlockPersistence, redactSecrets } from "./src/secret-scanner";
import { appendEvidenceRecord } from "./src/evidence";
import { linkEvidenceToCandidate } from "./src/evidence-link";
import { exportMemoryGraph, renderMemoryGraphSummary, saveMemoryGraphReport } from "./src/memory-graph";
import { buildMemoryTimeline, renderMemoryTimeline, saveMemoryTimelineReport } from "./src/timeline";
import { generateProcedureCandidates, renderProcedureCandidateReport, saveProcedureCandidateReport } from "./src/procedure-candidates";
import { buildRecallXray, renderRecallXrayReport } from "./src/recall-xray";
import { enqueueBackgroundAnalysis, listBackgroundAnalysisJobs, runBackgroundAnalysisQueue, type BackgroundAnalysisKind } from "./src/background-analysis";
import { scoreMemoryWorth } from "./src/memory-worth";
import { draftSkillFromProcedureCandidate } from "./src/skill-draft";
import { runFailureAnalysis, renderFailureAnalysisReport } from "./src/failure-analysis";
import { resolveMemoryProfile } from "./src/profile";
import type { CaptureCandidate, CodebaseAnalysisKind, CodebaseAnalysisTool, MemoryKind } from "./src/types";

function nowIso(): string { return new Date().toISOString(); }
function shortId(prefix: string): string {
  return `${prefix}_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 6)}`;
}
function parseCommandArgs(input: string): { positional: string[]; flags: Record<string, string | boolean> } {
  const tokens = [...input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = tokens[i + 1];
      if (next && !next.startsWith("--")) { flags[key] = next; i++; }
      else flags[key] = true;
    } else positional.push(token);
  }
  return { positional, flags };
}

const CODEBASE_EVIDENCE_TOOLS = new Set<CodebaseAnalysisTool>(["tsc", "eslint", "playwright", "vitest", "fallow", "custom"]);
const CODEBASE_ANALYSIS_KINDS = new Set<CodebaseAnalysisKind>(["typecheck", "lint", "test", "e2e", "dependency", "dead_code", "complexity", "security", "duplication", "custom"]);

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as any[]).filter((b) => b.type === "text").map((b) => b.text as string).join(" ");
  }
  return "";
}

export default function persistentIntelligence(pi: ExtensionAPI) {
  // root is resolved at session_start based on cwd — mutable for localPath support
  let root = resolveRoot();
  ensureMemoryDirs(root);

  const pendingUserMessages: string[] = [];
  const pendingAssistantMessages: string[] = [];
  let sessionCwd = process.cwd();

  // FTS index — synced after every canonical mutation
  let ftsIndex = new MemoryFtsIndex(root + "/search/memory-fts.db");
  syncFtsIndex(root, ftsIndex);

  // Session store — recreated at session_start if root changes
  let sessionStore = new SessionStore(root);
  sessionStore.load();

  // inboxOverlayShown: reset per session so the prompt shows once each time pi opens
  let inboxOverlayShown = false;
  let syncTimer: ReturnType<typeof setInterval> | null = null;
  let syncDebounce: ReturnType<typeof setTimeout> | null = null;
  const fsWatchers: ReturnType<typeof fsWatch>[] = [];

  // ─── Lifecycle ──────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    // Resolve root from cwd settings.json (localPath cascade)
    const newRoot = resolveRoot(ctx.cwd);
    if (newRoot !== root) {
      root = newRoot;
      ftsIndex.close();
      ftsIndex = new MemoryFtsIndex(root + "/search/memory-fts.db");
      sessionStore = new SessionStore(root);
      sessionStore.load();
    }
    // Sync FTS with current records on session start
    syncFtsIndex(root, ftsIndex);

    ensureMemoryDirs(root);
    sessionCwd = ctx.cwd ?? process.cwd();
    inboxOverlayShown = false;  // reset per session
    await setupQmd(root);

    // ── Session index sync ────────────────────────────────────────────
    try {
      const { added, updated } = sessionStore.sync();
      // Export markdown summaries for qmd semantic indexing
      const summariesDir = join(root, "sessions", "summaries");
      sessionStore.exportMarkdown(summariesDir);
      if (added + updated > 0 && ctx.hasUI) {
        ctx.ui.notify(`Session index: ${sessionStore.size()} sessions (${added} new, ${updated} updated)`, "info");
      }
    } catch { /* best-effort */ }

    // ── Session tools ─────────────────────────────────────────────────
    const sessionTools = buildSessionSearchTools(root, sessionStore);

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
              if (syncDebounce) clearTimeout(syncDebounce);
              syncDebounce = setTimeout(() => {
                try {
                  sessionStore.sync();
                  sessionStore.exportMarkdown(join(root, "sessions", "summaries"));
                } catch { /* ignore */ }
              }, 2000);
            });
            fsWatchers.push(watcher);
          } catch { /* fs.watch may not be available for this dir */ }
        }
      } catch { /* dynamic import may fail in some envs */ }

      // Fallback periodic sync every 5 minutes
      syncTimer = setInterval(() => {
        try {
          const { added, updated } = sessionStore.sync();
          if (added + updated > 0) sessionStore.exportMarkdown(join(root, "sessions", "summaries"));
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
  });

  pi.on("before_agent_start", async (event, ctx) => {
    // ── Inbox review — first turn only ─────────────────────────────────────
    // Step 1: InboxReviewOverlay summary — ✓/~ badges, [A]/[R]/[S] actions.
    //         Uses the same theme color mappings as PatchReviewPanel (via
    //         themeFromInbox) for visual consistency across the extension.
    // Step 2: If user picks [R] → open PatchReviewPanel for per-op selection
    //         (identical to /curate-memory propose mode).
    // minEvidenceCount: 1 — show all candidates for human review; evidence
    // gate (≥2) still enforced by the curator at apply time.
    if (!inboxOverlayShown && ctx.hasUI && ctx.ui.custom) {
      inboxOverlayShown = true;
      const cfg = loadConfig(root);
      const threshold = cfg.curator.autoCurateHighThreshold ?? 0.85;
      const promptThreshold = cfg.curator.inboxPromptThreshold ?? 3;
      const pending = listCandidates(root).filter((c) => c.status === "new");

      if (pending.length >= promptThreshold) {
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
            const patch = curateInbox(root, { now: nowIso(), mode: "auto", vaultPath, minEvidenceCount: 1 });
            const eligibleIds = patch.ops
              .filter((op) => op.risk !== "high" &&
                (op.record?.confidence ?? op.to_record?.confidence ?? 0) >= threshold)
              .map((op) => op.op_id);
            if (eligibleIds.length > 0) {
              applyPatch(root, patch, { selectedOpIds: eligibleIds, now: nowIso() });
              await updateQmd();
      syncFtsIndex(root, ftsIndex);
              ctx.ui.notify(`✓ Applied ${eligibleIds.length} memory op(s).`, "success");
            }

          } else if (action === "review") {
            // Chain a second ctx.ui.custom() call to show PatchReviewPanel.
            // The first ctx.ui.custom() (inbox overlay) must fully resolve before
            // calling the second -- they are sequential, not concurrent.
            // We are still inside before_agent_start at this point.
            if (ctx.ui.custom) {
              try {
                const cfg2 = loadConfig(root);
                const vaultPath2 = cfg2.vault.path ?? process.env.PI_VAULT_PATH;
                const reviewPatch = curateInbox(root, { now: nowIso(), mode: "propose", vaultPath: vaultPath2, minEvidenceCount: 1 });
                if (reviewPatch.ops.length > 0) {
                  const selectedIds = await ctx.ui.custom<string[] | null>(
                    (tui, theme, _kb, done) =>
                      createPatchReviewComponent(reviewPatch, done, tui as any, undefined, theme),
                  );
                  if (selectedIds && selectedIds.length > 0) {
                    applyPatch(root, reviewPatch, { selectedOpIds: selectedIds, now: nowIso() });
                    await updateQmd();
                    syncFtsIndex(root, ftsIndex);
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
    const context = await buildRetrievalContext(root, {
      prompt: event.prompt ?? "",
      today: todayString(),
      useQmd: true,
      qmdCollection: qmdCollectionName,
      ftsIndex,
      cwd: ctx.cwd ?? sessionCwd,
      threadId: (event as { session_id?: string; sessionId?: string }).session_id ?? (event as { sessionId?: string }).sessionId ?? "current-session",
    });
    const sessionBlock = buildSessionContextBlock(sessionStore, todayString());
    const inquiries = selectRelevantInquiries(root, {
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
  });

  pi.on("agent_end", async (event) => {
    for (const msg of (event.messages as any[]) ?? []) {
      if (msg.role === "user" && !msg.customType) {
        const text = extractText(msg.content);
        if (text.trim()) {
          pendingUserMessages.push(text);
          if (pendingUserMessages.length > 60) pendingUserMessages.shift();

          // Automatic correction capture — detects "don't use X", "prefer Y over Z",
          // "always use Z" etc. in user messages and adds them as inbox candidates
          // without requiring explicit memory_write calls. Confidence-gated:
          // strong corrections (≥0.85) become auto-eligible; weaker ones held for review.
          if (maybeCorrectionSignal(text)) {
            try {
              const selected = JSON.parse((await import("node:fs")).readFileSync(ensureMemoryDirs(root).runtime.selected, "utf-8")) as import("./src/types").MemoryRecord[];
              linkExplicitCorrectionToMemory(root, text, selected, { thread_id: "current-session", now: nowIso() });
            } catch { /* best-effort reinforcement linking */ }
            const candidate = extractCorrectionCandidate(text, todayString(), sessionCwd);
            if (candidate) {
              appendCandidate(root, candidate);
            }
          }
        }
      } else if (msg.role === "assistant") {
        const text = extractText(msg.content);
        if (text.trim()) {
          pendingAssistantMessages.push(text);
          if (pendingAssistantMessages.length > 60) pendingAssistantMessages.shift();
        }
      }
    }
  });

  pi.on("session_shutdown", async (event) => {
    // Clear all timers and watchers
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
    if (syncDebounce) { clearTimeout(syncDebounce); syncDebounce = null; }
    for (const w of fsWatchers) { try { w.close(); } catch { /* ignore */ } }
    fsWatchers.length = 0;

    if ((event as { reason?: string }).reason === "reload") return;

    appendDailyLog(root, todayString(), `<!-- ${nowIso()} -->\n## Session ended\n- Persistent Intelligence captured session end marker.`);

    // LLM consolidation — extracts candidates to inbox, deduped by Jaccard
    const cfg = loadConfig(root);
    const consolidationModel = process.env.PI_MEMORY_CONSOLIDATION_MODEL ?? "claude-haiku-4-5-20251001";
    let consolidationResult: { candidates_added: number; candidates_skipped_dedup: number } | null = null;

    if (pendingUserMessages.length >= 3) {
      try {
        consolidationResult = await runConsolidation(
          root, pendingUserMessages, pendingAssistantMessages,
          todayString(), sessionCwd, pi, consolidationModel,
        );
      } catch { /* best-effort */ }
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
        const patch = curateInbox(root, { now: nowIso(), mode: "auto", vaultPath, governanceMode: cfg.governance.mode });

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
            const applied = applyPatch(root, patch, { selectedOpIds: eligibleIds, now: nowIso() });
            syncFtsIndex(root, ftsIndex); // F-03 fix: sync immediately after auto-curation patch
            const skipped = patch.ops.length - eligibleIds.length;
            appendDailyLog(
              root, todayString(),
              `<!-- ${nowIso()} -->\n## Auto-curation\n- Applied ${applied.applied_ops.length} L2 op(s) automatically (${skipped} held for /curate-memory review).`,
            );
          }
        }
      } catch { /* best-effort — never crash shutdown */ }
    }

    // Log consolidation result (after curation, so it appears below auto-curation note)
    if (consolidationResult && consolidationResult.candidates_added > 0) {
      const held = listCandidates(root).filter((c) => c.status === "new").length;
      if (held > 0) {
        appendDailyLog(
          root, todayString(),
          `<!-- ${nowIso()} -->\n## Consolidation\n- ${consolidationResult.candidates_added} candidate(s) in inbox (${consolidationResult.candidates_skipped_dedup} deduped). ${held} await /curate-memory review.`,
        );
      }
    }

    pendingUserMessages.length = 0;
    pendingAssistantMessages.length = 0;

    await updateQmd();
      syncFtsIndex(root, ftsIndex);
  });

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

  pi.registerCommand("memory-doctor", {
    description: "Diagnose PI memory and session search setup",
    handler: async (_args, ctx) => {
      const paths = ensureMemoryDirs(root);
      const cfg = loadConfig(root);
      ctx.ui.notify(`PI memory root: ${paths.root}`, "info");
      ctx.ui.notify(`Session index: ${sessionStore.size()} sessions (file-watch + 5min sync active)`, "success");
      ctx.ui.notify(`Auto-curation: ${cfg.curator.autoCurate} (threshold: ${cfg.curator.autoCurateHighThreshold})`, cfg.curator.autoCurate !== "off" ? "success" : "warning");
      ctx.ui.notify(`Injection mode: ${cfg.retrieval.injectionMode}`, "info");
      ctx.ui.notify(`Consolidation model: ${process.env.PI_MEMORY_CONSOLIDATION_MODEL ?? "claude-haiku-4-5-20251001 (default)"}`, "info");
      ctx.ui.notify(`Vault: ${process.env.PI_VAULT_PATH ?? cfg.vault.path ?? "not configured (set PI_VAULT_PATH)"}`, (process.env.PI_VAULT_PATH || cfg.vault.path) ? "success" : "warning");
      const pending = listCandidates(root).filter((c) => c.status === "new").length;
      if (pending > 0) ctx.ui.notify(`Inbox: ${pending} candidate(s) awaiting /curate-memory`, "warning");
    },
  });


  pi.registerCommand("memory-diagnostics", {
    description: "Run memory integrity diagnostics and report findings (severity: ok/info/warning/error)",
    handler: async (args, ctx) => {
      const saveReport = args.includes("--save");
      try {
        const report = runMemoryDiagnostics(root);
        const text = renderDiagnosticsReport(report);
        ctx.ui.notify(text, report.summary.errors > 0 ? "error" : report.summary.warnings > 0 ? "warning" : "success");
        if (saveReport) {
          const path = saveDiagnosticsReport(root, report);
          ctx.ui.notify(`Diagnostics report saved: ${path}`, "info");
        }
      } catch (err) {
        ctx.ui.notify(`Diagnostics failed: ${err}`, "error");
      }
    },
  });

  pi.registerCommand("memory-recall-xray", {
    description: "Explain why memory would be included or excluded for a query (read-only). Usage: /memory-recall-xray <query>",
    handler: async (args, ctx) => {
      try {
        const query = args.trim();
        const profile = resolveMemoryProfile(root, sessionCwd);
        const report = buildRecallXray(root, { query, profile_id: profile.profile_id, resource_id: profile.resource_id, working_directory: sessionCwd, project_root: sessionCwd });
        ctx.ui.notify(renderRecallXrayReport(report), "info");
      } catch (err) {
        ctx.ui.notify(`Recall x-ray failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });

  pi.registerCommand("memory-evidence", {
    description: "Manage structured evidence. Usage: /memory-evidence add-codebase-analysis ... | /memory-evidence link <evidence-id> --statement \"...\" [--kind fact|event|instruction|task] [--tags testing,tooling] [--confidence 0.75]",
    handler: async (args, ctx) => {
      const parsed = parseCommandArgs(args);
      const action = parsed.positional[0];
      if (action === "link") {
        const evidenceId = parsed.positional[1];
        const statement = typeof parsed.flags.statement === "string" ? parsed.flags.statement : "";
        const tags = typeof parsed.flags.tags === "string" ? parsed.flags.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined;
        const confidence = typeof parsed.flags.confidence === "string" ? Number(parsed.flags.confidence) : undefined;
        const result = linkEvidenceToCandidate(root, {
          evidence_id: evidenceId,
          statement,
          kind: typeof parsed.flags.kind === "string" ? parsed.flags.kind as MemoryKind : undefined,
          tags,
          scope: typeof parsed.flags.scope === "string" ? parsed.flags.scope : undefined,
          confidence: Number.isFinite(confidence) ? confidence : undefined,
          forceReview: parsed.flags["force-review"] === true,
          now: nowIso(),
          cwd: sessionCwd,
        });
        ctx.ui.notify(redactSecrets(result.message), result.status === "failed" || result.status === "rejected" ? "warning" : "success");
        return;
      }
      if (action !== "add-codebase-analysis") {
        ctx.ui.notify("Usage: /memory-evidence add-codebase-analysis --tool <tsc|eslint|playwright|vitest|fallow|custom> --command \"<command>\" --exit-code <code> --analysis-kind <kind> OR /memory-evidence link <evidence-id> --statement \"...\"", "warning");
        return;
      }
      const tool = parsed.flags.tool;
      const analysisKind = parsed.flags["analysis-kind"];
      if (typeof tool !== "string" || !CODEBASE_EVIDENCE_TOOLS.has(tool as CodebaseAnalysisTool)) {
        ctx.ui.notify(`Invalid codebase evidence tool. Supported: ${[...CODEBASE_EVIDENCE_TOOLS].join(", ")}`, "error");
        return;
      }
      if (typeof analysisKind !== "string" || !CODEBASE_ANALYSIS_KINDS.has(analysisKind as CodebaseAnalysisKind)) {
        ctx.ui.notify(`Invalid codebase analysis kind. Supported: ${[...CODEBASE_ANALYSIS_KINDS].join(", ")}`, "error");
        return;
      }
      const command = typeof parsed.flags.command === "string" ? redactSecrets(parsed.flags.command) : undefined;
      const exitRaw = typeof parsed.flags["exit-code"] === "string" ? Number(parsed.flags["exit-code"]) : undefined;
      if (exitRaw !== undefined && !Number.isFinite(exitRaw)) {
        ctx.ui.notify("Invalid --exit-code; expected a number.", "error");
        return;
      }
      const profile = resolveMemoryProfile(root, sessionCwd);
      try {
        const record = appendEvidenceRecord(root, {
          id: "",
          resource_id: profile.resource_id,
          profile_id: profile.profile_id,
          thread_id: "manual-command",
          created_at: nowIso(),
          source_kind: "codebase_analysis",
          source_tool: tool,
          source_ref: command,
          source_summary: redactSecrets(typeof parsed.flags.summary === "string" ? parsed.flags.summary : `${tool} ${analysisKind} evidence${exitRaw === undefined ? "" : ` (exit ${exitRaw})`}`),
          trust_class: "passing_tool_or_test_outcome",
          polarity: exitRaw === undefined || exitRaw === 0 ? "supports" : "qualifies",
          durability_signal: "task",
          related_memory_ids: [],
          redaction_status: "none",
          codebase_analysis: {
            source_kind: "codebase_analysis",
            tool: tool as CodebaseAnalysisTool,
            command,
            exit_code: exitRaw,
            file_path: typeof parsed.flags.file === "string" ? redactSecrets(parsed.flags.file) : undefined,
            symbol: typeof parsed.flags.symbol === "string" ? redactSecrets(parsed.flags.symbol) : undefined,
            analysis_kind: analysisKind as CodebaseAnalysisKind,
            timestamp: nowIso(),
          },
        });
        ctx.ui.notify(`Added codebase-analysis evidence ${record.id}. Evidence is support, not automatic durable truth.`, "success");
      } catch (err) {
        ctx.ui.notify(`Failed to add codebase-analysis evidence: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });

  pi.registerCommand("memory-background", {
    description: "Queue and run inspectable local background memory analysis. Usage: /memory-background enqueue <kind>|run|list",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const action = parts[0] ?? "list";
      try {
        if (action === "enqueue") {
          const kind = (parts[1] ?? "diagnostics") as BackgroundAnalysisKind;
          const profile = resolveMemoryProfile(root, sessionCwd);
          const job = enqueueBackgroundAnalysis(root, { kind, profile_id: profile.profile_id, resource_id: profile.resource_id, input_summary: parts.slice(2).join(" ") || undefined }, nowIso());
          ctx.ui.notify(`Queued background analysis ${job.id} (${job.kind}).`, "success");
          return;
        }
        if (action === "run") {
          const jobs = runBackgroundAnalysisQueue(root, { now: nowIso() });
          ctx.ui.notify(jobs.map((j) => `${j.id} [${j.status}]${j.output_artifact_path ? ` ${j.output_artifact_path}` : ""}${j.error ? ` ${j.error}` : ""}`).join("\n") || "No background jobs.", "info");
          return;
        }
        const jobs = listBackgroundAnalysisJobs(root);
        ctx.ui.notify(jobs.map((j) => `${j.id} [${j.status}] ${j.kind}`).join("\n") || "No background jobs.", "info");
      } catch (err) {
        ctx.ui.notify(`Background analysis failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    },
  });

  pi.registerCommand("memory-worth", {
    description: "Score whether an observation is worth durable memory capture (read-only). Usage: /memory-worth <observation>",
    handler: async (args, ctx) => {
      const decision = scoreMemoryWorth({ observation: args, existingStatements: loadActiveRecords(root).map((r) => r.statement) });
      ctx.ui.notify(JSON.stringify(decision, null, 2), decision.decision === "reject" ? "warning" : "info");
    },
  });

  pi.registerCommand("memory-graph", {
    description: "Export governed memory dependency graph (read-only)",
    handler: async (args, ctx) => {
      try {
        const graph = exportMemoryGraph(root, nowIso());
        const summary = renderMemoryGraphSummary(graph);
        ctx.ui.notify(summary, "info");
        if (args.includes("--save")) {
          const path = saveMemoryGraphReport(root, graph);
          ctx.ui.notify(`Memory graph saved: ${path}`, "success");
        }
      } catch (err) {
        ctx.ui.notify(`Memory graph failed: ${err}`, "error");
      }
    },
  });

  pi.registerCommand("memory-timeline", {
    description: "Show memory timeline report. Usage: /memory-timeline [--memory <id>] [--save]",
    handler: async (args, ctx) => {
      try {
        const parts = args.trim().split(/\s+/).filter(Boolean);
        const memoryIndex = parts.indexOf("--memory");
        const memoryId = memoryIndex >= 0 ? parts[memoryIndex + 1] : undefined;
        const report = buildMemoryTimeline(root, { memoryId }, nowIso());
        ctx.ui.notify(renderMemoryTimeline(report), "info");
        if (parts.includes("--save")) {
          const path = saveMemoryTimelineReport(root, report);
          ctx.ui.notify(`Memory timeline saved: ${path}`, "success");
        }
      } catch (err) {
        ctx.ui.notify(`Memory timeline failed: ${err}`, "error");
      }
    },
  });

  pi.registerCommand("procedure-candidates", {
    description: "Generate review-only procedure candidates from repeated workflow memory",
    handler: async (args, ctx) => {
      try {
        const report = generateProcedureCandidates(root, { now: nowIso() });
        ctx.ui.notify(renderProcedureCandidateReport(report), report.candidates.length ? "success" : "info");
        if (args.includes("--save")) {
          const paths = saveProcedureCandidateReport(root, report);
          ctx.ui.notify(`Procedure candidate report saved: ${paths.mdPath}`, "success");
        }
      } catch (err) {
        ctx.ui.notify(`Procedure candidates failed: ${err}`, "error");
      }
    },
  });

  pi.registerCommand("memory-skill", {
    description: "Generate review-only skill draft artifacts from procedure candidates. Usage: /memory-skill draft <procedure-candidate-id>",
    handler: async (args, ctx) => {
      const parsed = parseCommandArgs(args);
      if (parsed.positional[0] !== "draft") { ctx.ui.notify("Usage: /memory-skill draft <procedure-candidate-id>", "warning"); return; }
      const result = draftSkillFromProcedureCandidate(root, parsed.positional[1] ?? "", nowIso());
      ctx.ui.notify(redactSecrets(result.message), result.status === "draft_created" ? "success" : "error");
    },
  });

  pi.registerCommand("memory-failures", {
    description: "Analyze failed jobs/rejected candidates into review-only learning artifacts. Usage: /memory-failures analyze [--save]",
    handler: async (args, ctx) => {
      const parsed = parseCommandArgs(args);
      if ((parsed.positional[0] ?? "analyze") !== "analyze") { ctx.ui.notify("Usage: /memory-failures analyze [--save]", "warning"); return; }
      const { report, path } = runFailureAnalysis(root, { now: nowIso(), save: parsed.flags.save === true });
      ctx.ui.notify(renderFailureAnalysisReport(report), "info");
      if (path) ctx.ui.notify(`Failure analysis saved: ${path}`, "success");
    },
  });

  pi.registerCommand("memory-inbox", {
    description: "Show and interactively review pending inbox candidates",
    handler: async (_args, ctx) => {
      const candidates = listCandidates(root).filter((c) => c.status === "new");
      if (candidates.length === 0) { ctx.ui.notify("Inbox empty.", "info"); return; }

      // Show interactive overlay if TUI is available
      if (ctx.ui.custom) {
        const cfg = loadConfig(root);
        const threshold = cfg.curator.autoCurateHighThreshold ?? 0.85;
        const vaultPath = cfg.vault.path ?? process.env.PI_VAULT_PATH;
        const autoEligible = candidates.filter((c) => (c.confidence ?? 0) >= threshold);
        try {
          const action = await ctx.ui.custom<import("./src/tui/InboxReviewOverlay").InboxOverlayAction>(
            (tui, theme, _kb, done) =>
              createInboxReviewComponent(
                { candidates, autoEligibleCount: autoEligible.length, highThreshold: threshold },
                done,
                tui as { requestRender(): void },
                theme,
              ),
          );
          if (action === "approve") {
            const patch = curateInbox(root, { now: nowIso(), mode: "auto", vaultPath, minEvidenceCount: 1 });
            const eligibleIds = patch.ops
              .filter((op) => op.risk !== "high" &&
                (op.record?.confidence ?? op.to_record?.confidence ?? 0) >= threshold)
              .map((op) => op.op_id);
            if (eligibleIds.length > 0) {
              applyPatch(root, patch, { selectedOpIds: eligibleIds, now: nowIso() });
              await updateQmd();
              syncFtsIndex(root, ftsIndex);
              ctx.ui.notify(`✓ Applied ${eligibleIds.length} memory op(s).`, "success");
            } else {
              ctx.ui.notify("No auto-eligible ops above confidence threshold.", "info");
            }
          } else if (action === "review") {
            // Chain PatchReviewPanel directly
            const reviewPatch = curateInbox(root, { now: nowIso(), mode: "propose", vaultPath, minEvidenceCount: 1 });
            if (reviewPatch.ops.length > 0) {
              const selectedIds = await ctx.ui.custom<string[] | null>(
                (tui, theme, _kb, done) =>
                  createPatchReviewComponent(reviewPatch, done, tui as any, undefined, theme),
              );
              if (selectedIds && selectedIds.length > 0) {
                applyPatch(root, reviewPatch, { selectedOpIds: selectedIds, now: nowIso() });
                await updateQmd();
                syncFtsIndex(root, ftsIndex);
                ctx.ui.notify(`✓ Applied ${selectedIds.length} memory op(s).`, "success");
              }
            } else {
              ctx.ui.notify("No candidates meet curation thresholds.", "info");
            }
          }
        } catch {
          // Headless fallback
          const lines = candidates.map((c, i) => `${i + 1}. [conf ${(c.confidence ?? 0).toFixed(2)}] ${c.text.slice(0, 80)}`);
          ctx.ui.notify(`${candidates.length} pending candidate(s):\n${lines.join("\n")}`, "info");
        }
      } else {
        // Plain text fallback for headless/RPC mode
        const lines = candidates.map((c, i) => `${i + 1}. [conf ${(c.confidence ?? 0).toFixed(2)}${c.ruleType ? ", " + c.ruleType : ""}] ${c.text.slice(0, 80)}`);
        ctx.ui.notify(`${candidates.length} pending candidate(s):\n${lines.join("\n")}`, "info");
      }
    },
  });

  pi.registerCommand("memory-learnings", {
    description: "Browse and manage long-term memory records in an interactive TUI table",
    handler: async (_args, ctx) => {
      if (!ctx.ui.custom) {
        // Headless fallback: list records as text
        const records = loadActiveRecords(root);
        const lines = records.map((r) =>
          `[${r.layer}, conf ${r.confidence.toFixed(2)}${r.ruleType ? ", " + r.ruleType : ""}] ${r.statement}`
        );
        ctx.ui.notify(lines.join("\n") || "No memory records.", "info");
        return;
      }
      const records = loadActiveRecords(root)
        .filter((r) => r.status === "active")
        .sort((a, b) => b.confidence - a.confidence);

      const result = await ctx.ui.custom<import("./src/tui/MemoryListPanel").ListPanelResult | null>(
        (tui, theme, _kb, done) => createMemoryListComponent(records, done, tui as { requestRender(): void }, theme),
      );

      if (result?.action === "deprecate") {
        const { loadLayerRecords, unsafeReplaceLayerRecords } = await import("./src/store");
        for (const layer of ["L1", "L2"] as const) {
          const layerRecords = loadLayerRecords(root, layer);
          if (!layerRecords.some((r) => r.id === result.recordId)) continue;
          unsafeReplaceLayerRecords(root, layer,
            layerRecords.map((r) => r.id === result.recordId
              ? { ...r, status: "deprecated" as const, updated_at: new Date().toISOString().slice(0, 10) }
              : r
            )
          );
          renderMemoryToDisk(root);
          syncFtsIndex(root, ftsIndex);
          await updateQmd();
              syncFtsIndex(root, ftsIndex);
          ctx.ui.notify(`Deprecated: ${result.recordId}`, "success");
          break;
        }
      }
    },
  });

  pi.registerCommand("curate-memory", {
    description: "Curate inbox into patch proposals (with vault_ref hints)",
    handler: async (args, ctx) => {
      const mode = args.includes("--mode=auto") ? "auto" : args.includes("--mode=supervised") ? "supervised" : "propose";
      const vaultPath = process.env.PI_VAULT_PATH;
      const patch = curateInbox(root, { now: nowIso(), mode, vaultPath });

      if (mode === "auto") {
        const applied = applyPatch(root, patch, { selectedOpIds: patch.ops.filter((op) => op.default_selected && op.risk !== "high").map((op) => op.op_id), now: nowIso() });
        await updateQmd();
      syncFtsIndex(root, ftsIndex);
        ctx.ui.notify(`Applied ${applied.applied_ops.length} memory op(s) from ${applied.patch_id}`, "success");

      } else if (patch.ops.length === 0) {
        ctx.ui.notify("No candidates meet curation thresholds.", "info");

      } else if (ctx.ui.custom) {
        // Interactive patch review panel — full terminal width, same as inbox review prompt
        const selectedIds = await ctx.ui.custom<string[] | null>(
          (tui, theme, _kb, done) =>
            createPatchReviewComponent(patch, done, tui as any, undefined, theme),
        );
        if (selectedIds && selectedIds.length > 0) {
          applyPatch(root, patch, { selectedOpIds: selectedIds, now: nowIso() });
          await updateQmd();
      syncFtsIndex(root, ftsIndex);
          ctx.ui.notify(`✓ Applied ${selectedIds.length} memory op(s).`, "success");
        } else if (selectedIds === null) {
          ctx.ui.notify("Curation cancelled — no changes made.", "info");
        }
      } else {
        // Headless fallback
        ctx.ui.notify(`${patch.patch_id}: ${patch.summary}`, "info");
        if (patch.ops.length > 0) {
          ctx.ui.notify(patch.ops.map((op) => `  ${op.op_id}: ${op.rationale}`).join("\n"), "info");
        }
      }
    },
  });

  pi.registerCommand("maintain-memory", {
    description: "Generate maintenance patch for overdue records and reinforcement-based recommendations",
    handler: async (args, ctx) => {
      const mode = args.includes("--mode=auto") ? "auto" : args.includes("--mode=supervised") ? "supervised" : "propose";
      const showReport = args.includes("--report");
      const patch = maintainMemory(root, { now: nowIso(), mode });

      // Sprint 10: generate reinforcement-based recommendations
      const records = loadActiveRecords(root);
      const summaries = records.map((rec) => summarizeReinforcement(readReinforcementEventsForMemory(root, rec.id))).filter((s) => s.counts.explicit_correction > 0 || s.counts.explicit_reinforcement > 0);
      const maintRecs = generateMaintenanceRecommendations(records, summaries, nowIso());
      const stabilityPatch = buildStabilityPatchFromRecommendations(maintRecs, nowIso());

      if (showReport) {
        const report = generateMaintenanceReport(maintRecs, records);
        ctx.ui.notify(report.slice(0, 2000), "info");
      }

      if (mode === "auto") {
        const decayOps = patch.ops.filter((op) => op.default_selected && op.risk !== "high").map((op) => op.op_id);
        if (decayOps.length > 0) {
          const applied = applyPatch(root, patch, { selectedOpIds: decayOps, now: nowIso() });
          await updateQmd();
          syncFtsIndex(root, ftsIndex);
          ctx.ui.notify(`Applied ${applied.applied_ops.length} maintenance ops from ${applied.patch_id}`, "success");
        }
        const stabilityOps = stabilityPatch.ops.filter((op) => op.default_selected && op.risk !== "high").map((op) => op.op_id);
        if (stabilityOps.length > 0) {
          const appliedStability = applyPatch(root, stabilityPatch, { selectedOpIds: stabilityOps, now: nowIso() });
          syncFtsIndex(root, ftsIndex);
          ctx.ui.notify(`Applied ${appliedStability.applied_ops.length} stability ops.`, "success");
        }
        if (maintRecs.filter((r) => r.requires_review).length > 0) {
          ctx.ui.notify(`${maintRecs.filter((r) => r.requires_review).length} recommendation(s) require human review.`, "warning");
        }
      } else {
        ctx.ui.notify(`${patch.patch_id}: ${patch.summary}`, "info");
        if (maintRecs.length > 0) ctx.ui.notify(`Reinforcement: ${maintRecs.length} maintenance recommendation(s). Use --report to see details.`, "info");
      }
    },
  });

  pi.registerCommand("memory-patches", {
    description: "List pending patch files",
    handler: async (_args, ctx) => {
      const { listPatchFiles, readPatchFile } = await import("./src/patch");
      const ids = listPatchFiles(root);
      if (ids.length === 0) { ctx.ui.notify("No patch files.", "info"); return; }
      const summaries = ids.map((id) => {
        try { const p = readPatchFile(root, id); return `${id} [${p.status}]: ${p.summary}`; } catch { return id; }
      });
      ctx.ui.notify(summaries.join("\n"), "info");
    },
  });

  pi.registerCommand("apply-memory-patch", {
    description: "Apply selected ops from a patch file by id",
    handler: async (args, ctx) => {
      const patchId = args.trim().split(/\s+/)[0];
      if (!patchId) { ctx.ui.notify("Usage: /apply-memory-patch <patch_id>", "warning"); return; }
      try {
        const { readPatchFile } = await import("./src/patch");
        const patch = readPatchFile(root, patchId);
        const hasDelete = patch.ops.some((op) => op.op === "delete");
        if (hasDelete) {
          const applied = applyPatchAndSync(root, patch, { now: nowIso() }, ftsIndex);
          await updateQmd();
          ctx.ui.notify(`Applied ${applied.applied_ops.length} op(s) from ${patchId} (FTS synced).`, "success");
        } else {
          const applied = applyPatch(root, patch, { now: nowIso() });
          await updateQmd();
          syncFtsIndex(root, ftsIndex);
          ctx.ui.notify(`Applied ${applied.applied_ops.length} op(s) from ${patchId}.`, "success");
        }
      } catch (err) {
        ctx.ui.notify(`Failed to apply patch: ${err}`, "error");
      }
    },
  });

  pi.registerCommand("meta-consolidation", {
    description: "Propose L1 abstractions from stable L2 record clusters (always requires human review)",
    handler: async (args, ctx) => {
      const withHandoff = args.includes("--handoff");
      const cfg = loadConfig(root);
      const metaCfg = { ...DEFAULT_META_CONSOLIDATION_CONFIG, ...cfg.metaConsolidation, enabled: true, cadence: "manual" as const };
      const profile = (await import("./src/profile")).resolveMemoryProfile(root, sessionCwd);
      ctx.ui.notify("Running meta-consolidation (no automatic changes)…", "info");
      try {
        const run = runMetaConsolidation(root, metaCfg, profile.profile_id, nowIso());
        ctx.ui.notify(`Meta-consolidation: ${run.clusters.length} cluster(s), ${run.candidates.length} L1 candidate(s) proposed.\nReport: ${run.report_path ?? "(none)"}`, "success");
        if (run.candidates.length > 0) {
          ctx.ui.notify(`All ${run.candidates.length} candidate(s) are l1_review_only — manually inspect report and apply patch if desired.`, "warning");
        }
        if (withHandoff) {
          const snapshot = generateHandoffSnapshot(root, { profile_id: profile.profile_id, now: nowIso() });
          ctx.ui.notify(`Handoff snapshot: ${snapshot.active_l2_count} L2 records, ${snapshot.open_inquiry_count} open inquiries.`, "info");
        }
      } catch (err) {
        ctx.ui.notify(`Meta-consolidation failed: ${err}`, "error");
      }
    },
  });

  pi.registerCommand("memory-handoff", {
    description: "Generate a handoff snapshot of current active memory state. Use --goal <goal> for goal handoff.",
    handler: async (args, ctx) => {
      try {
        const { resolveMemoryProfile } = await import("./src/profile");
        const profile = resolveMemoryProfile(root, sessionCwd);
        if (args.includes("--goal")) {
          const declaredGoal = args.replace("--goal", "").trim() || "Continue current goal safely.";
          const snapshot = generateGoalHandoffSnapshot(root, { declared_goal: declaredGoal, profile_id: profile.profile_id, now: nowIso() });
          ctx.ui.notify(`Goal handoff: ${snapshot.active_memory_ids.length} active memories, ${snapshot.open_inquiry_ids.length} open inquiries, ${snapshot.pending_candidate_ids.length} pending candidates. ${snapshot.background_reference_warning}`, "success");
          return;
        }
        const snapshot = generateHandoffSnapshot(root, { profile_id: profile.profile_id, now: nowIso() });
        ctx.ui.notify(`Handoff snapshot: ${snapshot.active_l2_count} L2 records, ${snapshot.open_inquiry_count} open inquiries, ${snapshot.pending_candidate_count} pending candidates.`, "success");
      } catch (err) {
        ctx.ui.notify(`Handoff failed: ${err}`, "error");
      }
    },
  });

  pi.registerCommand("render-memory", {
    description: "Render canonical JSONL to markdown",
    handler: async (_args, ctx) => {
      renderMemoryToDisk(root);
      await updateQmd();
      syncFtsIndex(root, ftsIndex);
      ctx.ui.notify("Rendered memory markdown projection", "success");
    },
  });

  pi.registerCommand("consolidate-memory", {
    description: "Manually trigger LLM consolidation from current session messages",
    handler: async (_args, ctx) => {
      if (pendingUserMessages.length < 2) {
        ctx.ui.notify("Not enough conversation to consolidate (need at least 2 user messages).", "warning");
        return;
      }
      const model = process.env.PI_MEMORY_CONSOLIDATION_MODEL ?? "claude-haiku-4-5-20251001";
      ctx.ui.notify("Running consolidation…", "info");
      try {
        const result = await runConsolidation(root, pendingUserMessages, pendingAssistantMessages, todayString(), sessionCwd, pi, model);
        await updateQmd();
      syncFtsIndex(root, ftsIndex);
        if (result.candidates_added > 0) {
          ctx.ui.notify(`Added ${result.candidates_added} candidate(s) to inbox (${result.candidates_skipped_dedup} deduped). Run /curate-memory to review.`, "success");
        } else {
          ctx.ui.notify(`No new patterns extracted (${result.candidates_skipped_dedup} deduped as already known).`, "info");
        }
      } catch (err) {
        ctx.ui.notify(`Consolidation failed: ${(err as Error).message}`, "error");
      }
    },
  });

  pi.registerCommand("session-sync", {
    description: "Sync session index with new/changed session files",
    handler: async (_args, ctx) => {
      const { added, updated, removed } = sessionStore.sync();
      const exported = sessionStore.exportMarkdown(join(root, "sessions", "summaries"));
      await updateQmd();
      syncFtsIndex(root, ftsIndex);
      ctx.ui.notify(`Session sync: ${added} added, ${updated} updated, ${removed} removed. Exported ${exported} markdown summaries. Total: ${sessionStore.size()}.`, "success");
    },
  });

  pi.registerCommand("session-reindex", {
    description: "Force full re-parse of all session files",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Re-indexing all sessions...", "info");
      const fresh = new SessionStore(root);
      const { added } = fresh.sync();
      const exported = fresh.exportMarkdown(join(root, "sessions", "summaries"));
      await updateQmd();
      syncFtsIndex(root, ftsIndex);
      ctx.ui.notify(`Re-indexed ${added} sessions. Exported ${exported} markdown summaries.`, "success");
    },
  });

  pi.registerCommand("setup-session-search", {
    description: "Show session search status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`Session index: ${sessionStore.size()} sessions. Tools: session_search, session_list, session_read, session_decisions.`, "success");
      ctx.ui.notify("Semantic search: run 'qmd embed' then use session_search with mode=semantic.", "info");
    },
  });
}

/**
 * Apply a patch and immediately sync the FTS index.
 * Callers that need to keep search results consistent after delete/purge operations
 * should prefer this over calling applyPatch + syncFtsIndex separately.
 */
export function applyPatchAndSync(
  root: string,
  patch: import("./src/types").MemoryPatch,
  options: import("./src/patch").ApplyPatchOptions,
  ftsIndex: MemoryFtsIndex,
): import("./src/types").MemoryPatch {
  const result = applyPatch(root, patch, options);
  syncFtsIndex(root, ftsIndex);
  return result;
}
