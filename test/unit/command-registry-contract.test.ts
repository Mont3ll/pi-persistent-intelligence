import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import persistentIntelligence from "../../index";

let originalRoot: string | undefined;
let root = "";

afterEach(() => {
  if (originalRoot === undefined) delete process.env.PI_MEMORY_ROOT;
  else process.env.PI_MEMORY_ROOT = originalRoot;
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("public command registry contract", () => {
  test("registers the complete stable command set exactly once", () => {
    originalRoot = process.env.PI_MEMORY_ROOT;
    root = mkdtempSync(join(tmpdir(), "pi-command-registry-"));
    process.env.PI_MEMORY_ROOT = root;
    const names: string[] = [];

    persistentIntelligence({
      on() {},
      exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
      getAllTools: () => [],
      sendUserMessage() {},
      registerTool() {},
      registerCommand(name: string) { names.push(name); },
    } as any);

    expect(names).toEqual([
      "memory-history",
      "memory-doctor",
      "memory-health-audit",
      "memory-diagnostics",
      "memory-store-integrity",
      "memory-key-repair",
      "memory-export",
      "memory-import",
      "memory-reconcile",
      "memory-governance",
      "memory-recall-xray",
      "memory-reinforce",
      "memory-inquiries",
      "memory-evidence",
      "memory-background",
      "memory-recall-effectiveness",
      "memory-capture-backfill",
      "memory-capture-audit",
      "memory-capture-quality",
      "memory-store-quality",
      "memory-quality",
      "memory-relationship-quality",
      "memory-worth",
      "memory-graph",
      "memory-timeline",
      "procedure-candidates",
      "memory-skill",
      "memory-failures",
      "memory-inbox",
      "memory-learnings",
      "curate-memory",
      "maintain-memory",
      "memory-simulate-patch",
      "memory-patches",
      "apply-memory-patch",
      "meta-consolidation",
      "memory-handoff",
      "render-memory",
      "consolidate-memory",
      "session-sync",
      "session-reindex",
      "setup-session-search",
    ]);
    expect(new Set(names).size).toBe(names.length);
  });
});
