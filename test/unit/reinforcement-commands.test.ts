import { describe, expect, test } from "bun:test";
import { createReinforcementCommands } from "../../src/commands/reinforcement";

describe("reinforcement command factory", () => {
  test("exposes reinforcement and inquiry lifecycle definitions", () => {
    const commands = createReinforcementCommands({
      getRoot: () => "/tmp/pi-reinforcement-test",
      nowIso: () => "2026-09-03T09:00:00.000Z",
    });
    expect(Object.keys(commands)).toEqual(["memoryReinforce", "memoryInquiries"]);
  });
});
