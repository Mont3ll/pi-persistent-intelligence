import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { addMemoryRecord } from "../../src/store";
import { maintainMemory } from "../../src/maintainer";
import { buildRetrievalContext } from "../../src/retriever";
import { addScratchpadItem } from "../../src/scratchpad";
import { appendDailyLog } from "../../src/daily";
import type { MemoryRecord } from "../../src/types";

let tempDirs: string[] = [];
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "pi-pi-maintain-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function record(id: string, layer: "L1" | "L2", nextReview = "2026-01-01", tags = ["workflow"], statement = `${id} statement about qmd and memory governance.`): MemoryRecord {
  return {
    id,
    layer,
    scope: { type: "global" },
    tags,
    statement,
    evidence: [{ type: "artifact", ref: "docs/spec.md", note: "documented" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    review: { cadence_days: 30, next_review: nextReview, change_condition: "If contradicted twice, revise." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
  };
}

describe("maintainer", () => {
  test("generates decay ops for overdue L2 records", () => {
    const root = tempRoot();
    ensureMemoryDirs(root);
    addMemoryRecord(root, record("mem_old", "L2", "2026-02-01"));
    const patch = maintainMemory(root, { now: "2026-05-08T00:00:00Z", mode: "propose" });
    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0].op).toBe("decay");
    expect(patch.ops[0].updates?.confidence).toBeLessThan(0.9);
  });
});

describe("retriever", () => {
  test("includes active L1, relevant L2, scratchpad, and daily tail", async () => {
    const root = tempRoot();
    ensureMemoryDirs(root);
    addMemoryRecord(root, record("mem_identity", "L1", "2026-12-01", ["preferences"]));
    addMemoryRecord(root, record("mem_qmd", "L2", "2026-12-01", ["qmd", "vault"]));
    addMemoryRecord(root, record("mem_unrelated", "L2", "2026-12-01", ["graphics"], "OpenGL polygon shading preference."));
    addScratchpadItem(root, "review the memory patch");
    appendDailyLog(root, "2026-05-08", "#decision qmd is used for vault search.");

    const context = await buildRetrievalContext(root, {
      prompt: "how should qmd search work?",
      today: "2026-05-08",
      maxDailyChars: 500,
    });

    expect(context.markdown).toContain("mem_identity");
    expect(context.markdown).toContain("mem_qmd");
    expect(context.markdown).not.toContain("mem_unrelated");
    expect(context.markdown).toContain("review the memory patch");
    expect(context.markdown).toContain("#decision qmd is used for vault search.");
    expect(context.selectedMemory.map((r) => r.id)).toEqual(["mem_identity", "mem_qmd"]);
  });
});
