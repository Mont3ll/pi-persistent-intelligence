import { describe, expect, test } from "bun:test";
import { createCaptureCommands } from "../../src/commands/capture";

describe("capture command factory", () => {
  test("exposes evidence, backfill, audit, and quality definitions", () => {
    const commands = createCaptureCommands({
      getRoot: () => "/tmp/pi-capture-test",
      getSessionCwd: () => "/tmp/project",
      nowIso: () => "2026-09-03T09:00:00.000Z",
      rememberCommand() {},
    });
    expect(Object.keys(commands)).toEqual(["memoryEvidence", "memoryCaptureBackfill", "memoryCaptureAudit", "memoryCaptureQuality"]);
  });
});
