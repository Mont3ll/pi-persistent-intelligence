import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { readRecallEvents } from "../../src/recall-events";
import { buildRetrievalContext } from "../../src/retriever";
import { unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

function root(): string {
  const r = mkdtempSync(join(tmpdir(), "pi-retriever-recall-"));
  ensureMemoryDirs(r);
  return r;
}

function rec(id: string, statement: string): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["testing"],
    statement,
    evidence: [{ type: "manual", ref: "ev", note: "support" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    review: { cadence_days: 30, next_review: "2026-08-01", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
  };
}

describe("retriever recall telemetry", () => {
  test("records selected and excluded memory ids without mutating durable memory", async () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem_selected", "Use bun test for this repository."));
    unsafeAddMemoryRecord(r, rec("mem_excluded", "Use pnpm for unrelated projects."));

    const result = await buildRetrievalContext(r, { prompt: "Please explain the testing workflow for this repository and include relevant persistent intelligence context", today: "2026-07-09", maxRecords: 1, useQmd: false });
    const events = readRecallEvents(r);

    expect(result.selectedMemory.map((memory) => memory.id)).toContain("mem_selected");
    expect(events).toHaveLength(1);
    expect(events[0].selected_memory_ids).toContain("mem_selected");
    expect(events[0].excluded_memory_ids).toContain("mem_excluded");
    expect(events[0].mutation_performed).toBe(false);
    rmSync(r, { recursive: true, force: true });
  });
});
