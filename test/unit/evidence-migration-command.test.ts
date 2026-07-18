import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import persistentIntelligence from "../../index";
import { ensureMemoryDirs } from "../../src/paths";
import type { MemoryRecord } from "../../src/types";

let oldRoot: string | undefined;
let dir = "";
afterEach(() => { if (oldRoot === undefined) delete process.env.PI_MEMORY_ROOT; else process.env.PI_MEMORY_ROOT = oldRoot; if (dir) rmSync(dir, { recursive: true, force: true }); });

test("/memory-evidence migrate-legacy previews and requires its reviewed fingerprint", async () => {
  oldRoot = process.env.PI_MEMORY_ROOT;
  dir = mkdtempSync(join(tmpdir(), "pi-evidence-command-"));
  process.env.PI_MEMORY_ROOT = dir;
  const paths = ensureMemoryDirs(dir);
  mkdirSync(join(dir, "daily"), { recursive: true });
  writeFileSync(join(dir, "daily", "2026-07-01.md"), "Confirmed workflow.\n");
  const record: MemoryRecord = {
    id: "mem_legacy", layer: "L2", scope: { type: "global" }, tags: [], statement: "Legacy.",
    evidence: [{ type: "manual", ref: "daily/2026-07-01.md", note: "legacy" }], confidence: 0.7, stability: "low",
    created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z", review: { cadence_days: 30, next_review: "2026-08-01", change_condition: "change" },
    status: "active", supersedes: [], superseded_by: [], vault_ref: null,
  };
  writeFileSync(paths.memory.L2, `${JSON.stringify(record)}\n`);
  const commands = new Map<string, any>(); const notifications: string[] = [];
  persistentIntelligence({ on() {}, exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }), getAllTools: () => [], sendUserMessage() {}, registerTool() {}, registerCommand(name: string, value: unknown) { commands.set(name, value); } } as any);
  const ctx = { cwd: dir, ui: { notify: (message: string) => notifications.push(message) } } as any;
  const before = readFileSync(paths.memory.evidence, "utf-8");

  await commands.get("memory-evidence").handler("migrate-legacy --json", ctx);
  const preview = JSON.parse(notifications.at(-1)!);
  expect(preview).toMatchObject({ dry_run: true, evidence_to_create: 1 });
  expect(readFileSync(paths.memory.evidence, "utf-8")).toBe(before);

  await commands.get("memory-evidence").handler("migrate-legacy --apply --json", ctx);
  expect(notifications.at(-1)).toContain("fingerprint");

  await commands.get("memory-evidence").handler(`migrate-legacy --apply --fingerprint ${preview.fingerprint} --json`, ctx);
  expect(JSON.parse(notifications.at(-1)!)).toMatchObject({ dry_run: false, mutation_performed: true });
});
