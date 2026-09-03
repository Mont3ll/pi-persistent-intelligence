import { describe, expect, test } from "bun:test";
import { createLearningCommands } from "../../src/commands/learning";

describe("learning command factory", () => {
  test("exposes review-only procedure, skill, and failure definitions", () => {
    const commands = createLearningCommands({ getRoot: () => "/tmp/pi-learning-test", nowIso: () => "2026-09-03T09:00:00.000Z" });
    expect(Object.keys(commands)).toEqual(["procedureCandidates", "memorySkill", "memoryFailures"]);
  });
});
