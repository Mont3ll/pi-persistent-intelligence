import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inferProjectScope } from "../../src/project";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-pi-project-detect-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

describe("project detection", () => {
  test("infers project from nearest package.json", () => {
    const dir = root();
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "my-package" }), "utf-8");
    expect(inferProjectScope(join(dir, "src"))).toEqual({ type: "project", project: "my-package" });
  });

  test("falls back to directory basename", () => {
    const dir = root();
    expect(inferProjectScope(dir).type).toBe("project");
    expect(inferProjectScope(dir).project).toContain("pi-pi-project-detect");
  });
});
