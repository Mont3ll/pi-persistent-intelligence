import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInteroperabilityCommands } from "../../src/commands/interoperability";
import { ensureMemoryDirs } from "../../src/paths";
import { resolveMemoryProfile } from "../../src/profile";
import { unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function createRoot(id?: string): string {
  const root = mkdtempSync(join(tmpdir(), "pi-interop-commands-"));
  roots.push(root);
  ensureMemoryDirs(root);
  const profile = resolveMemoryProfile(root, "/tmp/project", "2026-09-03T09:00:00.000Z");
  if (id) unsafeAddMemoryRecord(root, {
    id, layer: "L2", scope: { type: "global" }, tags: ["interop"], statement: `Record ${id}`,
    evidence: [{ type: "manual", ref: "synthetic:test", note: "fixture" }], confidence: 0.9,
    stability: "semi-stable", created_at: "2026-09-03", updated_at: "2026-09-03",
    review: { cadence_days: 30, next_review: "2026-10-03", change_condition: "If contradicted." },
    status: "active", supersedes: [], superseded_by: [], vault_ref: null, profile_id: profile.profile_id,
  } satisfies MemoryRecord);
  return root;
}

function context(notifications: string[]) {
  return { cwd: "/tmp", ui: { notify: (message: string) => notifications.push(message) } } as any;
}

describe("interoperability command factory", () => {
  test("preserves command definitions and resolves the active root lazily", async () => {
    const firstRoot = createRoot("mem_first");
    const secondRoot = createRoot("mem_second");
    let activeRoot = firstRoot;
    const notifications: string[] = [];
    const commands = createInteroperabilityCommands({ getRoot: () => activeRoot, getSessionCwd: () => "/tmp/project" });

    expect(Object.keys(commands)).toEqual(["memoryExport", "memoryImport", "memoryReconcile", "memoryGovernance"]);
    expect(commands.memoryReconcile.description).toContain("without mutation");

    const firstOutput = join(firstRoot, "first.json");
    await commands.memoryExport.handler(`--format pi-governance --output ${firstOutput}`, context(notifications));
    expect(JSON.parse(readFileSync(firstOutput, "utf8")).records.map((record: MemoryRecord) => record.id)).toEqual(["mem_first"]);

    activeRoot = secondRoot;
    const secondOutput = join(secondRoot, "second.json");
    await commands.memoryExport.handler(`--format pi-governance --output ${secondOutput}`, context(notifications));
    expect(JSON.parse(readFileSync(secondOutput, "utf8")).records.map((record: MemoryRecord) => record.id)).toEqual(["mem_second"]);
  });
});
