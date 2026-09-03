import { describe, expect, test } from "bun:test";
import { createSessionCommands } from "../../src/commands/sessions";

describe("session command factory", () => {
  test("exposes the stable session command definitions", () => {
    const commands = createSessionCommands({
      getRoot: () => "/tmp/pi-session-test",
      getSessionStore: () => ({ size: () => 0 } as any),
      getFtsIndex: () => ({} as any),
    });
    expect(Object.keys(commands)).toEqual(["sessionSync", "sessionReindex", "setupSessionSearch"]);
  });
});
