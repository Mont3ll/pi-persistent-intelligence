import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import persistentIntelligence from "../../index";
import { ensureMemoryDirs } from "../../src/paths";
import { readEvidenceRecords } from "../../src/evidence";

let oldRoot: string | undefined;
const dirs: string[] = [];
function setup() {
  oldRoot = process.env.PI_MEMORY_ROOT;
  const root = mkdtempSync(join(tmpdir(), "pi-evidence-cmd-"));
  dirs.push(root);
  process.env.PI_MEMORY_ROOT = root;
  ensureMemoryDirs(root);
  const commands = new Map<string, any>();
  const notifications: string[] = [];
  persistentIntelligence({
    on() {},
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    getAllTools: () => [],
    sendUserMessage() {},
    registerTool() {},
    registerCommand(name: string, def: unknown) { commands.set(name, def); },
  } as any);
  const ctx = { cwd: root, ui: { notify: (message: string) => notifications.push(message) } } as any;
  return { root, commands, ctx, notifications };
}

afterEach(() => {
  if (oldRoot === undefined) delete process.env.PI_MEMORY_ROOT; else process.env.PI_MEMORY_ROOT = oldRoot;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("/memory-evidence add-codebase-analysis", () => {
  test("valid command creates redacted codebase analysis evidence", async () => {
    const { root, commands, ctx } = setup();
    await commands.get("memory-evidence").handler('add-codebase-analysis --tool tsc --command "bun run typecheck --token ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD" --exit-code 0 --analysis-kind typecheck --file src/index.ts --symbol main --summary "typecheck passed"', ctx);
    const evidence = readEvidenceRecords(root);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].source_kind).toBe("codebase_analysis");
    expect(evidence[0].codebase_analysis?.tool).toBe("tsc");
    expect(evidence[0].codebase_analysis?.command).toContain("[redacted_secret:github_token]");
    expect(JSON.stringify(evidence[0])).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD");
  });

  test("invalid tool and analysis kind are rejected safely", async () => {
    const { root, commands, ctx, notifications } = setup();
    await commands.get("memory-evidence").handler('add-codebase-analysis --tool curl --command "curl" --exit-code 0 --analysis-kind network', ctx);
    expect(readEvidenceRecords(root)).toHaveLength(0);
    expect(notifications.join("\n")).toContain("Invalid codebase evidence tool");
  });
});
