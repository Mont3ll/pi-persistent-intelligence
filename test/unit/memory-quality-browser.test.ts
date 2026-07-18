import { describe, expect, test } from "bun:test";
import { memoryQualityBrowserOptions } from "../../src/tui/browser-adapters";
import type { MemoryQualityReport } from "../../src/memory-quality";

function report(): MemoryQualityReport {
  return {
    heuristic_version: "memory-quality-v2",
    generated_at: "2026-07-07T00:00:00Z",
    summary: { total_records: 2, low_quality_count: 1, stale_count: 1, duplicate_signal_count: 1, contested_count: 0, superseded_count: 0, average_quality: 72, structured_evidence_adoption_ratio: 0.5, unresolved_legacy_evidence_count: 1 },
    items: [
      { memory_id: "mem_low", layer: "L2", status: "active", lifecycle_state: "stale", quality_score: 42, confidence: 0.5, evidence_count: 1, live_evidence_count: 0, age_days: 200, days_since_update: 190, signals: ["low_confidence", "stale"], reasons: ["confidence below threshold", "updated 190 days ago"], statement_excerpt: "Low quality memory", mutation_performed: false },
      { memory_id: "mem_ok", layer: "L2", status: "active", lifecycle_state: "active", quality_score: 95, confidence: 0.9, evidence_count: 2, live_evidence_count: 2, age_days: 10, days_since_update: 3, signals: [], reasons: ["healthy"], statement_excerpt: "Healthy memory", mutation_performed: false },
    ],
    recommendations: [{ id: "mq_mem_low", memory_id: "mem_low", summary: "Review memory quality", reason: "stale low confidence", review_required: true, mutation_performed: false }],
    mutation_performed: false,
  };
}

describe("memory quality browser adapter", () => {
  test("renders quality rows with lifecycle and review-only details", () => {
    const opts = memoryQualityBrowserOptions(report());

    expect(opts.title).toContain("Memory Quality");
    expect(opts.items).toHaveLength(2);
    expect(opts.items[0].searchText).toContain("low_confidence");
    expect(opts.items[0].details?.join("\n")).toContain("No automatic mutation performed");
    expect(opts.columns.map((column) => column.key)).toEqual(expect.arrayContaining(["score", "lifecycle", "signals"]));
  });
});
