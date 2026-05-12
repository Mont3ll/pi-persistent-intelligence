import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { loadConfig, writeDefaultConfig } from "../../src/config";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-pi-config-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

describe("config", () => {
  test("loads safe defaults when config is absent", () => {
    const dir = root();
    const config = loadConfig(dir);
    expect(config.qmd.collection).toBe("pi-persistent-intelligence");
    expect(config.curator.minConfidence).toBe(0.75);
    expect(config.llm.enabled).toBe(false);
    expect(config.vault.enabled).toBe(false);
  });

  test("merges user config over defaults", () => {
    const dir = root();
    const paths = ensureMemoryDirs(dir);
    writeFileSync(paths.config, JSON.stringify({ curator: { minConfidence: 0.9 }, llm: { enabled: true, model: "test/model" } }), "utf-8");
    const config = loadConfig(dir);
    expect(config.curator.minConfidence).toBe(0.9);
    expect(config.curator.minEvidenceCount).toBe(2);
    expect(config.llm.enabled).toBe(true);
    expect(config.llm.model).toBe("test/model");
  });

  test("writes default config file", () => {
    const dir = root();
    const file = writeDefaultConfig(dir);
    expect(file.endsWith("config.json")).toBe(true);
    expect(loadConfig(dir).maintainer.stableDecay).toBe(0.05);
  });
});
