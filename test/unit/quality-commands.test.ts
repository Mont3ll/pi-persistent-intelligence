import { describe, expect, test } from "bun:test";
import { createQualityCommands } from "../../src/commands/quality";

describe("quality command factory", () => {
  test("exposes the stable report-only command definitions", () => {
    const commands = createQualityCommands({
      getRoot: () => "/tmp/pi-quality-test",
      getSessionCwd: () => "/tmp/project",
      nowIso: () => "2026-09-03T09:00:00.000Z",
      rememberCommand() {},
    });
    expect(Object.keys(commands)).toEqual([
      "memoryRecallXray", "memoryBackground", "memoryRecallEffectiveness", "memoryStoreQuality",
      "memoryQuality", "memoryRelationshipQuality", "memoryWorth", "memoryGraph", "memoryTimeline",
    ]);
  });
});
