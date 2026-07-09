import { describe, expect, test } from "bun:test";
import { storeQualityBrowserOptions } from "../../src/tui/browser-adapters";
import type { StoreQualityReport } from "../../src/store-quality";

function report(): StoreQualityReport {
  return {
    generated_at: "2026-07-09T00:00:00Z",
    overall_score: 78,
    status: "watch",
    inputs: { memory_quality_average: 80, relationship_quality_average: 75, recall_effectiveness_average: 68, active_memories: 10, pending_candidates: 3, runtime_warnings: 1 },
    metrics: [
      { id: "memory_quality", label: "Memory Quality", score: 80, status: "watch", summary: "1 low-quality memory.", signals: ["low_quality_memories"], mutation_performed: false },
      { id: "relationship_quality", label: "Relationship Quality", score: 75, status: "watch", summary: "2 weak edges.", signals: ["weak_relationships"], mutation_performed: false },
    ],
    recommendations: [{ id: "sq_memory_quality", metric_id: "memory_quality", summary: "Review memory quality", reason: "1 low-quality memory.", review_required: true, mutation_performed: false }],
    mutation_performed: false,
  };
}

describe("store quality browser adapter", () => {
  test("renders store-wide quality metric rows with review-only details", () => {
    const opts = storeQualityBrowserOptions(report());

    expect(opts.title).toContain("Store Quality");
    expect(opts.subtitle).toContain("report-only");
    expect(opts.items).toHaveLength(2);
    expect(opts.items[0].details?.join("\n")).toContain("No automatic mutation performed");
    expect(opts.columns.map((column) => column.key)).toEqual(expect.arrayContaining(["score", "status", "signals"]));
  });
});
