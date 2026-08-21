import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import persistentIntelligence from "../../index";
import { ensureMemoryDirs } from "../../src/paths";
import { readReinforcementEvents } from "../../src/reinforcement";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import { memoryRecordBrowserOptions } from "../../src/tui/browser-adapters";
import type { MemoryRecord } from "../../src/types";

const dirs: string[] = [];
const originalRoot = process.env.PI_MEMORY_ROOT;

afterEach(() => {
  if (originalRoot === undefined) delete process.env.PI_MEMORY_ROOT;
  else process.env.PI_MEMORY_ROOT = originalRoot;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function record(id = "mem_browser"): MemoryRecord {
  return {
    id,
    profile_id: "project:test",
    layer: "L2",
    scope: { type: "global" },
    tags: ["testing"],
    statement: "Use Bun for repository tests.",
    evidence: [{ type: "manual", ref: "ev", note: "support" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-07-01",
    updated_at: "2026-07-01",
    review: { cadence_days: 30, next_review: "2026-08-01", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
  };
}

describe("memory browser reinforcement", () => {
  test("offers reinforcement for the highlighted memory", () => {
    expect(memoryRecordBrowserOptions([record()]).actions).toContainEqual({ key: "r", label: "reinforce", action: "reinforce" });
  });

  test("records explicit reinforcement without mutating the memory record", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-memory-browser-reinforce-"));
    dirs.push(root);
    process.env.PI_MEMORY_ROOT = root;
    ensureMemoryDirs(root);
    const memory = record();
    unsafeAddMemoryRecord(root, memory);
    const before = JSON.stringify(loadAllRecords(root));
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
    const ctx = { cwd: root, ui: { notify: (message: string) => notifications.push(message), custom: async () => ({ action: "reinforce", id: memory.id }) } } as any;

    await commands.get("memory-learnings").handler("", ctx);

    expect(readReinforcementEvents(root)).toHaveLength(1);
    expect(readReinforcementEvents(root)[0]).toMatchObject({ memory_id: memory.id, outcome: "explicit_reinforcement", notes: "Confirmed from memory browser." });
    expect(JSON.stringify(loadAllRecords(root))).toBe(before);
    expect(notifications.join("\n")).toContain("Recorded explicit reinforcement");
  });
});
