import { describe, expect, test } from "bun:test";
import { createBrowserCommands } from "../../src/commands/browser";

describe("browser command factory", () => {
  test("exposes history, inbox, and learnings definitions", () => {
    const commands = createBrowserCommands({
      getRoot: () => "/tmp/pi-browser-test",
      getCommandHistory: () => [],
      getFtsIndex: () => ({} as any),
      nowIso: () => "2026-09-03T09:00:00.000Z",
      rememberCommand() {},
      syncFtsAfterPatch() {},
    });
    expect(Object.keys(commands)).toEqual(["memoryHistory", "memoryInbox", "memoryLearnings"]);
  });
});
