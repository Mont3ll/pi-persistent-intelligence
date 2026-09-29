import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLifecycleHandlers } from "../../src/lifecycle";

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

describe("lifecycle handler factory", () => {
  test("exposes every stable lifecycle hook", () => {
    const handlers = createLifecycleHandlers({} as any, {} as any, {} as any);
    expect(Object.keys(handlers)).toEqual(["sessionStart", "beforeAgentStart", "agentEnd", "sessionShutdown"]);
  });

  test("does not buffer or capture synthetic skill messages", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-lifecycle-synthetic-"));
    roots.push(root);
    const state = {
      root,
      sessionCwd: root,
      pendingUserMessages: [],
      pendingAssistantMessages: [],
      lastObservedModel: null,
    } as any;
    const handlers = createLifecycleHandlers({} as any, state, {
      nowIso: () => "2026-09-29T00:00:00Z",
      extractText: (content: unknown) => String(content),
      extractMessageModel: () => null,
      resolveConsolidationModel: () => ({ model: null, source: "pi-default" }),
      syncFtsAfterPatch: () => {},
    });

    await handlers.agentEnd({
      messages: [{ role: "user", content: '  <skill name="release">Always publish after tagging.</skill>' }],
      session_id: "session-test",
    });

    expect(state.pendingUserMessages).toEqual([]);
  });
});
