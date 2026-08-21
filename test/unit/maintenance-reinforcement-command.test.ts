import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import persistentIntelligence from "../../index";
import { ensureMemoryDirs } from "../../src/paths";
import { appendReinforcementEvent, createReinforcementEvent } from "../../src/reinforcement";
import { unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

const dirs: string[] = [];
const originalRoot = process.env.PI_MEMORY_ROOT;
afterEach(() => {
  if (originalRoot === undefined) delete process.env.PI_MEMORY_ROOT;
  else process.env.PI_MEMORY_ROOT = originalRoot;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function record(): MemoryRecord {
  return {
    id: "mem_implicit",
    profile_id: "project:test",
    layer: "L2",
    scope: { type: "global" },
    tags: ["testing"],
    statement: "Use Bun for repository tests.",
    evidence: [{ type: "manual", ref: "ev", note: "support" }],
    confidence: 0.9,
    stability: "low",
    created_at: "2026-08-01",
    updated_at: "2026-08-01",
    review: { cadence_days: 30, next_review: "2099-01-01", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
  };
}

describe("maintenance reinforcement command", () => {
  test("includes implicit-success review feedback without creating a stability operation", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-maintenance-reinforcement-"));
    dirs.push(root);
    process.env.PI_MEMORY_ROOT = root;
    ensureMemoryDirs(root);
    unsafeAddMemoryRecord(root, record());
    for (let index = 0; index < 5; index++) {
      appendReinforcementEvent(root, createReinforcementEvent({ memory_id: "mem_implicit", outcome: "implicit_success", thread_id: `session-${index}`, now: `2026-08-0${index + 1}T00:00:00Z` }));
    }
    const commands = new Map<string, any>();
    const notifications: string[] = [];
    persistentIntelligence({
      on() {},
      exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
      getAllTools: () => [],
      sendUserMessage() {},
      registerTool() {},
      registerCommand(name: string, definition: unknown) { commands.set(name, definition); },
    } as any);

    await commands.get("maintain-memory").handler("--report", { cwd: root, ui: { notify: (message: string) => notifications.push(message) } } as any);

    expect(notifications.join("\n")).toContain("implicit success events");
    expect(notifications.join("\n")).toContain("review required");
  });
});
