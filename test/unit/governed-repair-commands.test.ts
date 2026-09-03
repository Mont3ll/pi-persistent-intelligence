import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGovernedRepairCommands } from "../../src/commands/governed-repairs";
import { ensureMemoryDirs } from "../../src/paths";
import type { MemoryRecord } from "../../src/types";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function memoryRecord(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "mem_example",
    layer: "L2",
    scope: { type: "global" },
    tags: ["capture-backfill", "user_preference", "writing"],
    statement: "Avoid duplicate traversals.",
    evidence: [{ type: "manual", ref: "session:test", note: "captured" }],
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
    ...overrides,
  };
}

function createRoot(records: MemoryRecord[]): { root: string; memoryPath: string } {
  const root = mkdtempSync(join(tmpdir(), "pi-governed-repair-commands-"));
  roots.push(root);
  const paths = ensureMemoryDirs(root);
  writeFileSync(paths.memory.L2, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  return { root, memoryPath: paths.memory.L2 };
}

function context(notifications: string[]) {
  return { cwd: "/tmp", ui: { notify: (message: string) => notifications.push(message) } } as any;
}

describe("governed repair command factory", () => {
  test("resolves the active root lazily for each command", async () => {
    const integrity = createRoot([
      memoryRecord({ status: "superseded", superseded_by: ["mem_example"] }),
      memoryRecord({ status: "active", supersedes: ["mem_example"] }),
    ]);
    const keys = createRoot([memoryRecord({ id: "mem_key", statement: "Avoid snake_case unless required." })]);
    let activeRoot = integrity.root;
    const notifications: string[] = [];
    const commands = createGovernedRepairCommands({ getRoot: () => activeRoot, nowIso: () => "2026-09-03T09:00:00.000Z" });

    expect(commands.memoryStoreIntegrity.description).toContain("canonical record integrity repairs");
    expect(commands.memoryKeyRepair.description).toContain("normalized-memory-key repairs");

    await commands.memoryStoreIntegrity.handler("--json", context(notifications));
    expect(JSON.parse(notifications.at(-1)!)).toMatchObject({ dry_run: true, migration_needed: true, rows_before: 2 });

    activeRoot = keys.root;
    await commands.memoryKeyRepair.handler("--json", context(notifications));
    expect(JSON.parse(notifications.at(-1)!)).toMatchObject({ dryRun: true, targetCount: 1, applyEligible: true });
  });

  test("retains fingerprint gates without mutating either store", async () => {
    const integrity = createRoot([
      memoryRecord({ status: "superseded", superseded_by: ["mem_example"] }),
      memoryRecord({ status: "active", supersedes: ["mem_example"] }),
    ]);
    const keys = createRoot([memoryRecord({ id: "mem_key" })]);
    let activeRoot = integrity.root;
    const notifications: string[] = [];
    const commands = createGovernedRepairCommands({ getRoot: () => activeRoot, nowIso: () => "2026-09-03T09:00:00.000Z" });
    const integrityBefore = readFileSync(integrity.memoryPath, "utf8");
    const keysBefore = readFileSync(keys.memoryPath, "utf8");

    await commands.memoryStoreIntegrity.handler("--apply --json", context(notifications));
    expect(notifications.at(-1)).toContain("--fingerprint");

    activeRoot = keys.root;
    await commands.memoryKeyRepair.handler("--apply --json", context(notifications));
    expect(notifications.at(-1)).toContain("--fingerprint");
    expect(readFileSync(integrity.memoryPath, "utf8")).toBe(integrityBefore);
    expect(readFileSync(keys.memoryPath, "utf8")).toBe(keysBefore);
  });
});
