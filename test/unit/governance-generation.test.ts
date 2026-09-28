import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePaths } from "../../src/paths";
import { renderMemoryToDisk } from "../../src/render";
import { MemoryFtsIndex } from "../../src/search/fts";

let roots: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-k1-generation-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  roots = [];
});

describe("K1 revisioned canonical state", () => {
  test("memory paths expose durable governance generation metadata", () => {
    const dir = root();
    const paths = resolvePaths(dir);
    expect(paths.governance.canonicalState).toBe(join(dir, "governance", "canonical-state.json"));
    expect(paths.governance.projections).toBe(join(dir, "governance", "projections.json"));
  });

  test("legacy rendered memory identifies canonical generation zero", () => {
    const dir = root();
    const rendered = renderMemoryToDisk(dir);
    expect(rendered).toContain("Canonical generation: 0");
    expect(readFileSync(join(dir, "rendered", "MEMORY.md"), "utf8")).toContain("Canonical generation: 0");
  });

  test("FTS projection exposes the canonical generation used for rebuild", () => {
    const dir = root();
    const index = new MemoryFtsIndex(join(dir, "memory.sqlite"));
    expect(index.isAvailable).toBe(true);
    index.sync([{ id: "mem_generation", layer: "L2", confidence: 0.9, statement: "generation marker", tags: ["generation"] }]);
    expect(index.getGeneration()).toBe(0);
    index.close();
  });
});
