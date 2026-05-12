import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs, resolvePaths } from "../../src/paths";
import { appendJsonl, readJsonl, writeJsonl } from "../../src/jsonl";

let tempDirs: string[] = [];
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "pi-pi-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("paths", () => {
  test("resolves the canonical memory layout", () => {
    const root = tempRoot();
    const paths = resolvePaths(root);
    expect(paths.memory.L1).toBe(join(root, "memory", "L1.identity.jsonl"));
    expect(paths.memory.L2).toBe(join(root, "memory", "L2.playbooks.jsonl"));
    expect(paths.rendered.memory).toBe(join(root, "rendered", "MEMORY.md"));
    expect(paths.inbox.captured).toBe(join(root, "inbox", "captured.jsonl"));
  });

  test("creates required directories and seed files", () => {
    const root = tempRoot();
    const paths = ensureMemoryDirs(root);
    expect(readJsonl(paths.memory.L1)).toEqual([]);
    expect(readJsonl(paths.memory.L2)).toEqual([]);
    expect(readJsonl(paths.inbox.captured)).toEqual([]);
  });
});

describe("jsonl", () => {
  test("writes, appends, and reads records", () => {
    const root = tempRoot();
    const file = join(root, "records.jsonl");
    writeJsonl(file, [{ id: "a" }]);
    appendJsonl(file, { id: "b" });
    expect(readJsonl<{ id: string }>(file)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  test("ignores blank lines", () => {
    const root = tempRoot();
    const file = join(root, "blank.jsonl");
    writeJsonl(file, [{ id: "a" }]);
    appendJsonl(file, { id: "b" });
    expect(readJsonl(file).length).toBe(2);
  });
});
