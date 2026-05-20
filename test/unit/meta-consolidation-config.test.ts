import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { loadConfig, defaultConfig } from "../../src/config";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-metacfg-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

describe("meta-consolidation config", () => {
  test("defaults: metaConsolidation is disabled and manual", () => {
    expect(defaultConfig.metaConsolidation.enabled).toBe(false);
    expect(defaultConfig.metaConsolidation.cadence).toBe("manual");
    expect(defaultConfig.metaConsolidation.require_counterexample_search).toBe(true);
    expect(defaultConfig.metaConsolidation.max_candidates_per_run).toBe(5);
  });

  test("loadConfig merges metaConsolidation from config.json", () => {
    const dir = root();
    writeFileSync(join(dir, "config.json"), JSON.stringify({
      metaConsolidation: { enabled: true, cadence: "weekly", min_l2_records: 3 }
    }), "utf-8");
    const cfg = loadConfig(dir);
    expect(cfg.metaConsolidation.enabled).toBe(true);
    expect(cfg.metaConsolidation.cadence).toBe("weekly");
    expect(cfg.metaConsolidation.min_l2_records).toBe(3);
    expect(cfg.metaConsolidation.require_counterexample_search).toBe(true);
  });

  test("defaults apply when metaConsolidation key is absent from config.json", () => {
    const dir = root();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ governance: { mode: "strict" } }), "utf-8");
    const cfg = loadConfig(dir);
    expect(cfg.metaConsolidation.enabled).toBe(false);
    expect(cfg.metaConsolidation.cadence).toBe("manual");
  });

  test("canonical key is camelCase metaConsolidation, consistent with autoCurate/minConfidence", () => {
    const dir = root();
    writeFileSync(join(dir, "config.json"), JSON.stringify({
      metaConsolidation: { enabled: false }
    }), "utf-8");
    const cfg = loadConfig(dir);
    expect(typeof cfg.metaConsolidation).toBe("object");
    expect(typeof (cfg as any).meta_consolidation).toBe("undefined");
  });
});
