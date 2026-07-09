import { describe, expect, test } from "bun:test";
import { recallEffectivenessBrowserOptions } from "../../src/tui/browser-adapters";
import type { RecallEffectivenessReport } from "../../src/recall-effectiveness";

function report(): RecallEffectivenessReport {
  return {
    generated_at: "2026-07-09T00:00:00Z",
    summary: { total_events: 2, selected_memory_count: 1, never_recalled_count: 1, corrected_after_recall_count: 1, average_effectiveness: 68 },
    memory_stats: [
      { memory_id: "mem_a", status: "active", layer: "L2", selected_count: 0, excluded_count: 1, correction_count: 0, effectiveness_score: 65, signals: ["never_recalled"], mutation_performed: false },
      { memory_id: "mem_b", status: "active", layer: "L2", selected_count: 1, excluded_count: 0, correction_count: 1, effectiveness_score: 55, signals: ["recalled_then_corrected"], mutation_performed: false },
    ],
    recommendations: [{ id: "re_mem_a", memory_id: "mem_a", summary: "Review recall effectiveness", reason: "never_recalled", review_required: true, mutation_performed: false }],
    mutation_performed: false,
  };
}

describe("recall effectiveness browser adapter", () => {
  test("renders recall stats with review-only details", () => {
    const opts = recallEffectivenessBrowserOptions(report());

    expect(opts.title).toContain("Recall Effectiveness");
    expect(opts.subtitle).toContain("report-only");
    expect(opts.items).toHaveLength(2);
    expect(opts.items[0].details?.join("\n")).toContain("No automatic mutation performed");
    expect(opts.columns.map((column) => column.key)).toEqual(expect.arrayContaining(["score", "selected", "signals"]));
  });
});
