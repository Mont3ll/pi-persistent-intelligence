import { join } from "node:path";
import { updateQmd } from "../qmd";
import { syncFtsIndex } from "../retriever";
import { SessionStore } from "../session-search";
import type { MemoryFtsIndex } from "../search/fts";
import type { CommandDefinition } from "./types";

type SessionDependencies = {
  getRoot(): string;
  getSessionStore(): SessionStore;
  getFtsIndex(): MemoryFtsIndex;
};

type SessionCommands = {
  sessionSync: CommandDefinition;
  sessionReindex: CommandDefinition;
  setupSessionSearch: CommandDefinition;
};

export function createSessionCommands(dependencies: SessionDependencies): SessionCommands {
  return {
    sessionSync: {
      description: "Sync session index with new/changed session files",
      handler: async (_args, context) => {
        const root = dependencies.getRoot();
        const sessionStore = dependencies.getSessionStore();
        const { added, updated, removed } = sessionStore.sync();
        const exported = sessionStore.exportMarkdown(join(root, "sessions", "summaries"));
        await updateQmd();
        syncFtsIndex(root, dependencies.getFtsIndex());
        context.ui.notify(`Session sync: ${added} added, ${updated} updated, ${removed} removed. Exported ${exported} markdown summaries. Total: ${sessionStore.size()}.`, "success");
      },
    },
    sessionReindex: {
      description: "Force full re-parse of all session files",
      handler: async (_args, context) => {
        context.ui.notify("Re-indexing all sessions...", "info");
        const root = dependencies.getRoot();
        const fresh = new SessionStore(root);
        const { added } = fresh.sync();
        const exported = fresh.exportMarkdown(join(root, "sessions", "summaries"));
        await updateQmd();
        syncFtsIndex(root, dependencies.getFtsIndex());
        context.ui.notify(`Re-indexed ${added} sessions. Exported ${exported} markdown summaries.`, "success");
      },
    },
    setupSessionSearch: {
      description: "Show session search status",
      handler: async (_args, context) => {
        context.ui.notify(`Session index: ${dependencies.getSessionStore().size()} sessions. Tools: session_search, session_list, session_read, session_decisions.`, "success");
        context.ui.notify("Semantic search: run 'qmd embed' then use session_search with mode=semantic.", "info");
      },
    },
  };
}
