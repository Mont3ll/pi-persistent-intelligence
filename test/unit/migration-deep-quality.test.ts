import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importLegacyMemoryMarkdown } from "../../src/migration";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-pi-migrate-deep-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

describe("deep legacy migration scoring", () => {
  test("extracts evidence refs and scores rich entries above threshold", () => {
    const dir = root();
    const legacy = join(dir, "MEMORY.md");
    writeFileSync(legacy, `### Durable workflow\nUse patch review for memory changes.\n**Stability**: stable | **Confidence**: 0.88 | **Review**: 90 days\n**Evidence**: project-a, commit abc123, daily/2026-05-09.md\n**Change condition**: If patches become too slow across 3 projects, revise.\n**Tags**: #memory #workflow\n`, "utf-8");
    const result = importLegacyMemoryMarkdown(dir, legacy, { now: "2026-05-09T00:00:00Z" });
    expect(result.candidates[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.candidates[0].evidence_refs).toContain("commit abc123");
    expect(result.quality.highConfidence).toBe(1);
  });

  test("keeps very weak entries reviewable but low confidence", () => {
    const dir = root();
    const legacy = join(dir, "MEMORY.md");
    writeFileSync(legacy, `### Maybe\nSomething.\n`, "utf-8");
    const result = importLegacyMemoryMarkdown(dir, legacy, { now: "2026-05-09T00:00:00Z" });
    expect(result.candidates[0].confidence).toBeLessThan(0.7);
    expect(result.quality.lowConfidence).toBe(1);
  });
});
