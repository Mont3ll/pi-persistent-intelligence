import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeRecallEffectiveness, renderRecallEffectivenessReport } from "../../src/recall-effectiveness";
import { appendRecallEvent, readRecallEvents } from "../../src/recall-events";
import { ensureMemoryDirs } from "../../src/paths";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

function root(): string {
  const r = mkdtempSync(join(tmpdir(), "pi-recall-effectiveness-"));
  ensureMemoryDirs(r);
  return r;
}

function rec(id: string): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["recall"],
    statement: `Recall memory ${id}`,
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

describe("recall effectiveness analytics", () => {
  test("summarizes recalled, never recalled, and correction-adjacent memories without mutation", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem_hot"));
    unsafeAddMemoryRecord(r, rec("mem_never"));
    unsafeAddMemoryRecord(r, rec("mem_corrected"));
    appendRecallEvent(r, { id: "rec_1", timestamp: "2026-07-09T00:00:00Z", query_hash: "q1", prompt_excerpt: "how to test", selected_memory_ids: ["mem_hot", "mem_corrected"], excluded_memory_ids: ["mem_never"], source: "retrieval", mutation_performed: false });
    appendRecallEvent(r, { id: "rec_2", timestamp: "2026-07-09T00:01:00Z", query_hash: "q2", prompt_excerpt: "test again", selected_memory_ids: ["mem_hot"], excluded_memory_ids: [], source: "retrieval", mutation_performed: false });
    appendRecallEvent(r, { id: "rec_3", timestamp: "2026-07-09T00:02:00Z", query_hash: "q3", prompt_excerpt: "correction", selected_memory_ids: ["mem_corrected"], excluded_memory_ids: [], source: "correction", outcome: "corrected", mutation_performed: false });
    const before = JSON.stringify(loadAllRecords(r));

    const report = analyzeRecallEffectiveness(r, { now: "2026-07-09T01:00:00Z" });

    expect(readRecallEvents(r)).toHaveLength(3);
    expect(report.summary.total_events).toBe(3);
    expect(report.summary.never_recalled_count).toBe(1);
    expect(report.memory_stats.find((item) => item.memory_id === "mem_hot")?.selected_count).toBe(2);
    expect(report.memory_stats.find((item) => item.memory_id === "mem_never")?.signals).toContain("never_recalled");
    expect(report.memory_stats.find((item) => item.memory_id === "mem_corrected")?.signals).toContain("recalled_then_corrected");
    expect(report.recommendations.every((rec) => rec.review_required && rec.mutation_performed === false)).toBe(true);
    expect(report.mutation_performed).toBe(false);
    expect(JSON.stringify(loadAllRecords(r))).toBe(before);
    expect(renderRecallEffectivenessReport(report)).toContain("No automatic mutation performed");
    rmSync(r, { recursive: true, force: true });
  });
});
