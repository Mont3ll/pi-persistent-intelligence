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

function record(id: string, statement: string): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["capture-backfill", "user_preference", "writing"],
    statement,
    evidence: [{ type: "manual", ref: `session:${id}`, note: "captured" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-08-01",
    updated_at: "2026-08-01",
    review: { cadence_days: 30, next_review: "2026-08-31", change_condition: "If corrected." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "avoid_pattern",
    profile_id: "legacy",
    normalized_key: "legacy|global|global|capture-backfill|avoid-pattern",
  };
}

function setup() {
  oldRoot = process.env.PI_MEMORY_ROOT;
  const root = mkdtempSync(join(tmpdir(), "pi-memory-key-command-"));
  roots.push(root);
  process.env.PI_MEMORY_ROOT = root;
  const paths = ensureMemoryDirs(root);
  writeFileSync(paths.memory.L2, `${[
    record("mem_duplicate", "Avoid duplicate traversals."),
    record("mem_snake_case", "Avoid snake_case unless required."),
  ].map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
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

describe("/memory-key-repair", () => {
  test("previews by default and requires a reviewed fingerprint for apply", async () => {
    const { paths, commands, notifications, ctx } = setup();
    const before = readFileSync(paths.memory.L2, "utf8");

    await commands.get("memory-key-repair").handler("--json", ctx);

    const preview = JSON.parse(notifications.at(-1)!);
    expect(preview).toMatchObject({ dryRun: true, mutationPerformed: false, targetCount: 2, applyEligible: true });
    expect(preview.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(paths.memory.L2, "utf8")).toBe(before);

    await commands.get("memory-key-repair").handler("--apply --json", ctx);
    expect(notifications.at(-1)).toContain("--fingerprint");
    expect(readFileSync(paths.memory.L2, "utf8")).toBe(before);
  });

  test("applies only the reviewed isolated fixture plan", async () => {
    const { paths, commands, notifications, ctx } = setup();
    await commands.get("memory-key-repair").handler("--json", ctx);
    const preview = JSON.parse(notifications.at(-1)!);

    await commands.get("memory-key-repair").handler(`--apply --fingerprint ${preview.fingerprint} --json`, ctx);

    const result = JSON.parse(notifications.at(-1)!);
    expect(result).toMatchObject({ dryRun: false, mutationPerformed: true, targetCount: 2, postApplyTargetCount: 0 });
    expect(readFileSync(paths.memory.L2, "utf8")).toContain('"normalized_key":"v2|legacy|global|global|duplicate-traversals|avoid-pattern"');
  });
});
