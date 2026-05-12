import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importLegacyMemoryMarkdown } from "../../src/migration";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-pi-migrate-quality-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

describe("migration quality scoring", () => {
  test("assigns higher confidence when legacy block contains evidence and change condition", () => {
    const dir = root();
    const legacy = join(dir, "MEMORY.md");
    writeFileSync(legacy, `### Strong memory\nUseful durable pattern.\n**Evidence**: project A, project B\n**Change condition**: revise if it fails twice\n**Tags**: #workflow\n\n### Weak memory\nUnstructured note.\n`, "utf-8");
    const result = importLegacyMemoryMarkdown(dir, legacy, { now: "2026-05-09T00:00:00Z" });
    expect(result.candidates[0].confidence).toBeGreaterThan(result.candidates[1].confidence ?? 0);
    expect(result.candidates[0].evidence_refs).toContain(legacy);
  });
});
