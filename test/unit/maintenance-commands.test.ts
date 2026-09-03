import { describe, expect, test } from "bun:test";
import { createMaintenanceCommands } from "../../src/commands/maintenance";

describe("maintenance command factory", () => {
  test("exposes curation, maintenance, patch, handoff, rendering, and consolidation definitions", () => {
    const commands = createMaintenanceCommands({
      getRoot: () => "/tmp/pi-maintenance-test", getSessionCwd: () => "/tmp/project",
      getFtsIndex: () => ({} as any), getPendingUserMessages: () => [], getPendingAssistantMessages: () => [],
      getObservedModel: () => null, getRunner: () => ({ exec: async () => ({ stdout: "", code: 0 }) }),
      nowIso: () => "2026-09-03T09:00:00.000Z", rememberCommand() {}, syncFtsAfterPatch() {},
      resolveConsolidationModel: () => ({ model: null, source: "pi-default" }),
    });
    expect(Object.keys(commands)).toEqual([
      "curateMemory", "maintainMemory", "memorySimulatePatch", "memoryPatches", "applyMemoryPatch",
      "metaConsolidation", "memoryHandoff", "renderMemory", "consolidateMemory",
    ]);
  });
});
