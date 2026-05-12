import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importLegacyMemoryMarkdown } from "../../src/migration";
import { listCandidates } from "../../src/inbox";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-pi-migrate-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

describe("legacy migration", () => {
  test("imports legacy MEMORY.md headings as inbox candidates", () => {
    const dir = root();
    const legacy = join(dir, "MEMORY.md");
    writeFileSync(legacy, `# Long-Term Memory\n\n### Development workflow\n**Stability**: stable | **Confidence**: 0.95\nUse TDD for feature work.\n**Tags**: #workflow #testing\n\n### Tool preferences\nPrefer file-based tools.\n**Tags**: #preferences\n`, "utf-8");
    const result = importLegacyMemoryMarkdown(dir, legacy, { now: "2026-05-09T00:00:00Z" });
    expect(result.imported).toBe(2);
    const candidates = listCandidates(dir);
    expect(candidates[0].text).toContain("Development workflow");
    expect(candidates[0].tags).toContain("workflow");
  });
});
