import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord } from "../../src/store";
import { buildRetrievalContext, syncFtsIndex } from "../../src/retriever";
import { MemoryFtsIndex } from "../../src/search/fts";
import type { MemoryRecord } from "../../src/types";

const roots: string[] = [];
afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0; });

function record(id: string, statement: string, applicable = false): MemoryRecord {
  return {
    id, layer: "L2", scope: { type: "global" }, tags: ["testing"],
    statement, confidence: 0.92, stability: "semi-stable",
    created_at: "2026-10-01", updated_at: "2026-10-01",
    evidence: [{ type: "manual", ref: "unit", note: "grounded fixture" }],
    review: { cadence_days: 30, next_review: "2026-11-01", change_condition: "If changed." },
    status: "active", supersedes: [], superseded_by: [], vault_ref: null,
    ...(applicable ? { applies_when: ["testing"] } : {}),
  };
}

function populatedStore(): { root: string; targetId: string; excludedId: string } {
  const root = mkdtempSync(join(tmpdir(), "pi-populated-recall-"));
  roots.push(root);
  ensureMemoryDirs(root);
  for (let i = 0; i < 14; i++) {
    unsafeAddMemoryRecord(root, record(
      `mem_broad_${String(i).padStart(2, "0")}`,
      `This project maintains a general release testing workflow checklist ${i}.`,
      true,
    ));
  }
  const targetId = "mem_distinct_accepted";
  unsafeAddMemoryRecord(root, record(
    targetId,
    "The saffronquartz validation procedure is required during release checks.",
  ));
  const excludedId = "mem_other_project";
  unsafeAddMemoryRecord(root, {
    ...record(excludedId, "Use inaccessiblequartz tooling in another project."),
    scope: { type: "project", project: "unrelated-project" },
  });
  return { root, targetId, excludedId };
}

describe("populated store memory selection", () => {
  test("FTS full-query miss does not let earlier broadly applicable records starve a relevant memory", async () => {
    const { root, targetId } = populatedStore();
    const fts = new MemoryFtsIndex(join(root, "search", "fts.db"));
    try {
      syncFtsIndex(root, fts);
      const result = await buildRetrievalContext(root, {
        prompt: "Which saffronquartz validation procedure should be used for release checks in this project?",
        today: "2026-10-28", cwd: root, ftsIndex: fts, useQmd: false,
        maxRecords: 8,
      });
      expect(result.selectedMemory.map((memory) => memory.id)).toContain(targetId);
      expect(result.markdown).toContain("saffronquartz");
      expect(result.selectedMemory.length).toBeLessThanOrEqual(8);
    } finally { fts.close(); }
  });

  test("native term ranking respects the populated L2 budget without an FTS index", async () => {
    const { root, targetId } = populatedStore();
    const result = await buildRetrievalContext(root, {
      prompt: "Which saffronquartz validation procedure should be used for release checks in this project?",
      today: "2026-10-28", cwd: root, useQmd: false, maxRecords: 8,
    });
    expect(result.selectedMemory.map((memory) => memory.id)).toContain(targetId);
    expect(result.selectedMemory.length).toBeLessThanOrEqual(8);
  });

  test("rare query terms never override governed project scope exclusions", async () => {
    const { root, excludedId } = populatedStore();
    const fts = new MemoryFtsIndex(join(root, "search", "fts.db"));
    try {
      syncFtsIndex(root, fts);
      const result = await buildRetrievalContext(root, {
        prompt: "Explain the inaccessiblequartz tooling policy for this project.",
        today: "2026-10-28", cwd: root, ftsIndex: fts, useQmd: false,
        maxRecords: 8,
      });
      expect(result.selectedMemory.map((memory) => memory.id)).not.toContain(excludedId);
    } finally { fts.close(); }
  });
});
