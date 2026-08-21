import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import persistentIntelligence from "../../index";
import { ensureMemoryDirs } from "../../src/paths";
import { readReinforcementEvents } from "../../src/reinforcement";
import type { MemoryRecord } from "../../src/types";

const dirs: string[] = [];
const originalRoot = process.env.PI_MEMORY_ROOT;

afterEach(() => {
  if (originalRoot === undefined) delete process.env.PI_MEMORY_ROOT;
  else process.env.PI_MEMORY_ROOT = originalRoot;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function record(id: string, statement: string): MemoryRecord {
  return {
    id,
    profile_id: "project:test",
    layer: "L2",
    scope: { type: "global" },
    tags: ["testing"],
    statement,
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

describe("reinforcement runtime attribution", () => {
  test("passes operation context and actual session provenance to deterministic attribution", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-reinforcement-runtime-"));
    dirs.push(root);
    process.env.PI_MEMORY_ROOT = root;
    const paths = ensureMemoryDirs(root);
    writeFileSync(paths.runtime.selected, JSON.stringify([
      record("mem_reinforcement", "Run reinforcement tests."),
      record("mem_capture", "Run capture tests."),
    ]));

    const handlers = new Map<string, Function>();
    persistentIntelligence({
      on(name: string, handler: Function) { handlers.set(name, handler); },
      exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
      getAllTools: () => [],
      sendUserMessage() {},
      registerTool() {},
      registerCommand() {},
    } as any);

    await handlers.get("agent_end")?.({
      session_id: "session-runtime-42",
      messages: [{ role: "toolResult", toolName: "bash", input: { command: "bun test test/unit/reinforcement.test.ts" }, details: { code: 0 } }],
    });

    const events = readReinforcementEvents(root);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ memory_id: "mem_reinforcement", outcome: "implicit_success", thread_id: "session-runtime-42" });
    expect(events[0].notes).not.toContain("test/unit/reinforcement.test.ts");
  });
});
