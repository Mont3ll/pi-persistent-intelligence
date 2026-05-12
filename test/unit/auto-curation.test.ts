import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendCandidate } from "../../src/inbox";
import { curateInbox } from "../../src/curator";
import { applyPatch } from "../../src/patch";
import { loadActiveRecords } from "../../src/store";
import { loadConfig, defaultConfig } from "../../src/config";
import type { CaptureCandidate } from "../../src/types";

let dirs: string[] = [];
function root() {
  const dir = mkdtempSync(join(tmpdir(), "pi-autoc-"));
  dirs.push(dir);
  ensureMemoryDirs(dir);
  return dir;
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

function candidate(confidence: number, id = "cap_test"): CaptureCandidate {
  return {
    id,
    created_at: new Date().toISOString(),
    source: { type: "manual", ref: "daily/2026-05-12.md" },
    text: `Test pattern with confidence ${confidence}`,
    tags: ["workflow"],
    evidence_refs: ["daily/2026-05-12.md", "docs/spec.md"],
    confidence,
    status: "new",
  };
}

describe("tiered auto-curation logic", () => {
  test("high-only: ops at or above threshold are auto-eligible", () => {
    const dir = root();
    appendCandidate(dir, candidate(0.90));
    appendCandidate(dir, candidate(0.78, "cap_low"));

    const patch = curateInbox(dir, { now: new Date().toISOString(), mode: "auto" });
    const highThreshold = defaultConfig.curator.autoCurateHighThreshold;

    const autoIds = patch.ops
      .filter((op) => {
        if (!op.default_selected || op.risk === "high") return false;
        const conf = op.record?.confidence ?? op.to_record?.confidence ?? 0;
        return conf >= highThreshold;
      })
      .map((op) => op.op_id);

    // 0.90 candidate should qualify for auto-apply
    expect(autoIds.length).toBeGreaterThanOrEqual(1);

    const applied = applyPatch(dir, patch, { selectedOpIds: autoIds, now: new Date().toISOString() });
    expect(applied.applied_ops.length).toBeGreaterThanOrEqual(1);

    // Active records should contain the high-confidence one
    const records = loadActiveRecords(dir);
    expect(records.some((r) => r.confidence >= highThreshold)).toBe(true);
  });

  test("high-only: ops below threshold are not auto-applied", () => {
    const dir = root();
    appendCandidate(dir, candidate(0.76)); // below 0.85 default threshold

    const patch = curateInbox(dir, { now: new Date().toISOString(), mode: "auto" });
    const highThreshold = defaultConfig.curator.autoCurateHighThreshold;

    const autoIds = patch.ops
      .filter((op) => {
        if (!op.default_selected || op.risk === "high") return false;
        const conf = op.record?.confidence ?? op.to_record?.confidence ?? 0;
        return conf >= highThreshold;
      })
      .map((op) => op.op_id);

    expect(autoIds.length).toBe(0); // nothing auto-applied
    expect(loadActiveRecords(dir).length).toBe(0);
  });

  test("all-eligible: all default_selected low-risk ops are applied", () => {
    const dir = root();
    appendCandidate(dir, candidate(0.76));
    appendCandidate(dir, candidate(0.88, "cap_2"));

    const patch = curateInbox(dir, { now: new Date().toISOString(), mode: "auto" });
    const allIds = patch.ops
      .filter((op) => op.default_selected && op.risk !== "high")
      .map((op) => op.op_id);

    expect(allIds.length).toBe(2);
    applyPatch(dir, patch, { selectedOpIds: allIds, now: new Date().toISOString() });
    expect(loadActiveRecords(dir).length).toBe(2);
  });

  test("default config has autoCurate: high-only with threshold 0.85", () => {
    expect(defaultConfig.curator.autoCurate).toBe("high-only");
    expect(defaultConfig.curator.autoCurateHighThreshold).toBe(0.85);
  });

  test("loadConfig merges autoCurate settings from disk", () => {
    const dir = root();
    const { writeFileSync } = require("node:fs");
    writeFileSync(require("node:path").join(dir, "config.json"), JSON.stringify({
      curator: { autoCurate: "off" }
    }), "utf-8");
    const cfg = loadConfig(dir);
    expect(cfg.curator.autoCurate).toBe("off");
    expect(cfg.curator.autoCurateHighThreshold).toBe(0.85); // preserved from default
  });
});
