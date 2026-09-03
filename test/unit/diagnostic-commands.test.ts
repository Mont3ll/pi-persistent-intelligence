import { describe, expect, test } from "bun:test";
import { createDiagnosticCommands } from "../../src/commands/diagnostics";

describe("diagnostic command factory", () => {
  test("exposes the stable diagnostic command definitions", () => {
    const commands = createDiagnosticCommands({
      getRoot: () => "/tmp/pi-diagnostics-test",
      getSessionCount: () => 0,
      getObservedModel: () => null,
      nowIso: () => "2026-09-03T09:00:00.000Z",
      resolveConsolidationModel: () => ({ model: null, source: "pi-default" }),
      rememberCommand() {},
    });

    expect(Object.keys(commands)).toEqual(["memoryDoctor", "memoryHealthAudit", "memoryDiagnostics"]);
    expect(commands.memoryDoctor.description).toContain("session search setup");
    expect(commands.memoryHealthAudit.description).toContain("report-only");
    expect(commands.memoryDiagnostics.description).toContain("integrity diagnostics");
  });
});
