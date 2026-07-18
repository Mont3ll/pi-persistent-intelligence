import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import persistentIntelligence from "../../index";
import { ensureMemoryDirs } from "../../src/paths";
import type { MemoryRecord } from "../../src/types";

const roots: string[] = [];
let oldRoot: string | undefined;

afterEach(() => {
  if (oldRoot === undefined) delete process.env.PI_MEMORY_ROOT; else process.env.PI_MEMORY_ROOT = oldRoot;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function record(status: MemoryRecord["status"], edges: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "mem_dup",
    layer: "L2",
    scope: { type: "global" },
    tags: ["workflow"],
    statement: `duplicate ${status}`,
    evidence: [{ type: "manual", ref: "daily/2026-07-18.md", note: "captured" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-07-18",
    updated_at: "2026-07-18",
    review: { cadence_days: 30, next_review: "2026-08-17", change_condition: "If contradicted." },
    status,
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...edges,
  };
}

function setup() {
  oldRoot = process.env.PI_MEMORY_ROOT;
  const root = mkdtempSync(join(tmpdir(), "pi-integrity-command-"));
  roots.push(root);
  process.env.PI_MEMORY_ROOT = root;
  const paths = ensureMemoryDirs(root);
  writeFileSync(paths.memory.L2, [
    record("superseded", { superseded_by: ["mem_dup"] }),
    record("active", { supersedes: ["mem_dup"] }),
  ].map((item) => JSON.stringify(item)).join("\n") + "\n", "utf-8");
  const commands = new Map<string, any>();
  const notifications: string[] = [];
  persistentIntelligence({
    on() {}, exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    getAllTools: () => [], sendUserMessage() {}, registerTool() {},
    registerCommand(name: string, definition: unknown) { commands.set(name, definition); },
  } as any);
  const ctx = { cwd: root, ui: { notify: (message: string) => notifications.push(message) } } as any;
  return { root, paths, commands, notifications, ctx };
}

describe("/memory-store-integrity", () => {
  test("previews by default and requires the reviewed fingerprint for apply", async () => {
    const { paths, commands, notifications, ctx } = setup();
    const before = readFileSync(paths.memory.L2, "utf-8");

    await commands.get("memory-store-integrity").handler("--json", ctx);

    expect(readFileSync(paths.memory.L2, "utf-8")).toBe(before);
    const preview = JSON.parse(notifications.at(-1)!);
    expect(preview).toMatchObject({ dry_run: true, mutation_performed: false, migration_needed: true });
    expect(preview.fingerprint).toMatch(/^[a-f0-9]{64}$/);

    await commands.get("memory-store-integrity").handler("--apply --json", ctx);
    expect(notifications.at(-1)).toContain("--fingerprint");
    expect(readFileSync(paths.memory.L2, "utf-8")).toBe(before);
  });

  test("applies only with the reviewed fingerprint", async () => {
    const { paths, commands, notifications, ctx } = setup();
    await commands.get("memory-store-integrity").handler("--json", ctx);
    const preview = JSON.parse(notifications.at(-1)!);

    await commands.get("memory-store-integrity").handler(`--apply --fingerprint ${preview.fingerprint} --json`, ctx);

    const result = JSON.parse(notifications.at(-1)!);
    expect(result).toMatchObject({ dry_run: false, mutation_performed: true, rows_before: 2, rows_after: 1 });
    expect(readFileSync(paths.memory.L2, "utf-8").trim().split("\n")).toHaveLength(1);
  });
});
