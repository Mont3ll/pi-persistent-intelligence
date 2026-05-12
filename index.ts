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
import { appendCandidate, listCandidates } from "./src/inbox";
import { curateInbox } from "./src/curator";
import { maintainMemory } from "./src/maintainer";
import { applyPatch } from "./src/patch";
import { buildRetrievalContext } from "./src/retriever";
import { renderMemoryToDisk } from "./src/render";
import { setupQmd, updateQmd, runQmd, qmdSearchArgs, qmdCollectionName, type MemorySearchMode } from "./src/qmd";
import { runConsolidation } from "./src/consolidator";
import { loadConfig } from "./src/config";
import { SessionStore, buildSessionSearchTools, buildSessionContextBlock, SESSION_SYNC_INTERVAL_MS } from "./src/session-search";
import { isChildProcess } from "./src/sessions/store";
import { InboxReviewOverlay, createInboxReviewComponent, buildInboxNotification, type InboxOverlayAction } from "./src/tui/InboxReviewOverlay";
import { createPatchReviewComponent } from "./src/tui/PatchReviewPanel";

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

export default function persistentIntelligence(pi: ExtensionAPI) {
  // root is resolved at session_start based on cwd — mutable for localPath support
  let root = resolveRoot();
  ensureMemoryDirs(root);

  const pendingUserMessages: string[] = [];
  const pendingAssistantMessages: string[] = [];
  let sessionCwd = process.cwd();

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
      sessionStore = new SessionStore(root);
      sessionStore.load();
    }

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
  });

  pi.on("before_agent_start", async (event, ctx) => {
    // ── Inbox review prompt — first turn only ────────────────────────────
    // When pending inbox candidates ≥ threshold and ctx.ui.custom is available,
    // renders the inbox review in the prompt/editor area (same as /curate-memory)
    // before the first agent turn. Escape / 's' dismisses cleanly.
    if (!inboxOverlayShown && ctx.hasUI && ctx.ui.custom) {
      inboxOverlayShown = true;
      const cfg = loadConfig(root);
      const threshold = cfg.curator.autoCurateHighThreshold ?? 0.85;
      const promptThreshold = cfg.curator.inboxPromptThreshold ?? 3;
      const pending = listCandidates(root).filter((c) => c.status === "new");

      if (pending.length >= promptThreshold) {
        // Auto-eligible for the overlay = confidence above threshold.
        // The curator enforces minEvidenceCount (≥2) when actually promoting to L2,
        // so the overlay count accurately previews high-confidence candidates while
        // governance is maintained at apply time.
        const autoEligible = pending.filter(
          (c) => (c.confidence ?? 0) >= threshold,
        );

        const buildTheme = (theme: any) => theme
          ? {
              border:   (s: string) => theme.fg("border",  s),
              title:    (s: string) => theme.fg("accent",  s),
              accent:   (s: string) => theme.fg("accent",  s),
              success:  (s: string) => theme.fg("success", s),
              warning:  (s: string) => theme.fg("warning", s),
              dim:      (s: string) => theme.fg("dim",     s),
              content:  (s: string) => theme.fg("text", s),
              selected: (s: string) => theme.fg("accent",  s),
            }
          : undefined;

        try {
          // Step 1: inbox summary prompt
          const action = await ctx.ui.custom<InboxOverlayAction>(
            (tui, theme, _kb, done) => createInboxReviewComponent(
              { candidates: pending, autoEligibleCount: autoEligible.length, highThreshold: threshold },
              done,
              tui as { requestRender(): void },
              buildTheme(theme),
            ),
          );

          if (action === "approve" && autoEligible.length > 0) {
            // Apply auto-eligible ops
            const vaultPath = cfg.vault.path ?? process.env.PI_VAULT_PATH;
            const patch = curateInbox(root, { now: nowIso(), mode: "auto", vaultPath });
            const eligibleIds = patch.ops
              .filter((op) => op.default_selected && op.risk !== "high" &&
                (op.record?.confidence ?? op.to_record?.confidence ?? 0) >= threshold)
              .map((op) => op.op_id);
            if (eligibleIds.length > 0) {
              applyPatch(root, patch, { selectedOpIds: eligibleIds, now: nowIso() });
              await updateQmd();
              ctx.ui.notify(`✓ Applied ${eligibleIds.length} memory op(s).`, "success");
            }

          } else if (action === "review") {
            // Step 2: open PatchReviewPanel for per-op selection
            const vaultPath = cfg.vault.path ?? process.env.PI_VAULT_PATH;
            const patch = curateInbox(root, { now: nowIso(), mode: "propose", vaultPath });
            if (patch.ops.length > 0) {
              const selectedIds = await ctx.ui.custom<string[] | null>(
                (tui, theme, _kb, done) =>
                  createPatchReviewComponent(patch, done, tui as any, undefined, theme),
              );
              if (selectedIds && selectedIds.length > 0) {
                applyPatch(root, patch, { selectedOpIds: selectedIds, now: nowIso() });
                await updateQmd();
                ctx.ui.notify(`✓ Applied ${selectedIds.length} memory op(s) from review.`, "success");
              }
            } else {
              ctx.ui.notify("No candidates meet curation thresholds.", "info");
            }
          }
          // "skip" / null: candidates stay in inbox, session continues
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
    });
    const sessionBlock = buildSessionContextBlock(sessionStore, todayString());
    const combined = sessionBlock
      ? `${context.markdown}\n\n## Today's Sessions\n${sessionBlock}`
      : context.markdown;

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
        const patch = curateInbox(root, { now: nowIso(), mode: "auto", vaultPath });

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
        return { content: [{ type: "text", text: `Appended to daily log ${todayString()}.` }], details: {} };
      }
      const candidate = {
        id: shortId("cap"),
        created_at: nowIso(),
        source: { type: "manual", ref: `daily/${todayString()}.md`, cwd: process.cwd() },
        text: params.content,
        tags: params.tags ?? [],
        evidence_refs: [`daily/${todayString()}.md`],
        confidence: params.confidence ?? 0.7,
        status: "new" as const,
      };
      appendCandidate(root, candidate);
      return { content: [{ type: "text", text: `Captured long-term memory candidate ${candidate.id}; run /curate-memory to review.` }], details: candidate };
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
    description: "Search PI memory through qmd (keyword, semantic, or deep hybrid).",
    parameters: Type.Object({
      query: Type.String(),
      mode: Type.Optional(Type.Union([Type.Literal("keyword"), Type.Literal("semantic"), Type.Literal("deep")])),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(_id, params) {
      const mode = (params.mode ?? "keyword") as MemorySearchMode;
      const result = await runQmd(qmdSearchArgs(params.query, mode, params.limit ?? 5), 60_000);
      return { content: [{ type: "text", text: result.stdout || "No results." }], details: {} };
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
      ctx.ui.notify(`Consolidation model: ${process.env.PI_MEMORY_CONSOLIDATION_MODEL ?? "claude-haiku-4-5-20251001 (default)"}`, "info");
      ctx.ui.notify(`Vault: ${process.env.PI_VAULT_PATH ?? cfg.vault.path ?? "not configured (set PI_VAULT_PATH)"}`, (process.env.PI_VAULT_PATH || cfg.vault.path) ? "success" : "warning");
      const pending = listCandidates(root).filter((c) => c.status === "new").length;
      if (pending > 0) ctx.ui.notify(`Inbox: ${pending} candidate(s) awaiting /curate-memory`, "warning");
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
    description: "Generate maintenance patch for overdue records",
    handler: async (args, ctx) => {
      const mode = args.includes("--mode=auto") ? "auto" : args.includes("--mode=supervised") ? "supervised" : "propose";
      const patch = maintainMemory(root, { now: nowIso(), mode });
      if (mode === "auto") {
        const applied = applyPatch(root, patch, { selectedOpIds: patch.ops.filter((op) => op.default_selected && op.risk !== "high").map((op) => op.op_id), now: nowIso() });
        await updateQmd();
        ctx.ui.notify(`Applied ${applied.applied_ops.length} maintenance ops from ${applied.patch_id}`, "success");
      } else {
        ctx.ui.notify(`${patch.patch_id}: ${patch.summary}`, "info");
      }
    },
  });

  pi.registerCommand("render-memory", {
    description: "Render canonical JSONL to markdown",
    handler: async (_args, ctx) => {
      renderMemoryToDisk(root);
      await updateQmd();
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
