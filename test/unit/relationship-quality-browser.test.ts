import { describe, expect, test } from "bun:test";
import { relationshipQualityBrowserOptions } from "../../src/tui/browser-adapters";
import type { RelationshipQualityReport } from "../../src/relationship-quality";

function report(): RelationshipQualityReport {
  return {
    heuristic_version: "relationship-quality-v2",
    generated_at: "2026-07-07T00:00:00Z",
    summary: {
      total_edges: 2,
      active_edge_count: 1,
      historical_edge_count: 1,
      auxiliary_edge_count: 0,
      weak_edge_count: 1,
      dangling_edge_count: 0,
      orphan_memory_count: 1,
      dead_end_memory_count: 1,
      high_value_hub_count: 0,
      cyclic_memory_pair_count: 0,
      average_relationship_quality: 35,
    },
    relationships: [{
      edge_id: "supported_by:memory_record:mem_a->evidence_record:ev_a",
      type: "supported_by",
      from: "memory_record:mem_a",
      to: "evidence_record:ev_a",
      quality_score: 35,
      quality_band: "weak",
      quality_population: "active",
      signals: ["redacted_or_deleted_evidence"],
      reasons: ["relationship depends on redacted or deleted evidence"],
      mutation_performed: false,
    }, {
      edge_id: "tombstoned_by:memory_record:mem_old->tombstone:tomb_old",
      type: "tombstoned_by",
      from: "memory_record:mem_old",
      to: "tombstone:tomb_old",
      quality_score: 0,
      quality_band: "broken",
      quality_population: "historical",
      signals: ["dangling_endpoint"],
      reasons: ["historical relationship"],
      mutation_performed: false,
    }],
    memory_nodes: [{
      memory_id: "mem_a",
      quality_population: "active",
      degree: 1,
      live_evidence_edges: 0,
      weak_edges: 1,
      contradiction_edges: 0,
      supersession_edges: 0,
      reinforcement_edges: 0,
      signals: ["orphan_memory"],
      reasons: ["memory has no live evidence"],
      mutation_performed: false,
    }],
    recommendations: [{
      id: "rq_weak_edges",
      summary: "Review weak memory relationships",
      reason: "1 relationship edge is weak.",
      affected_ids: ["supported_by:memory_record:mem_a->evidence_record:ev_a"],
      review_required: true,
      mutation_performed: false,
    }],
    mutation_performed: false,
  };
}

describe("relationship quality browser adapter", () => {
  test("renders relationship rows with review-only details", () => {
    const opts = relationshipQualityBrowserOptions(report());

    expect(opts.title).toContain("Relationship Quality");
    expect(opts.subtitle).toContain("Active average");
    expect(opts.subtitle).toContain("report-only");
    expect(opts.items).toHaveLength(2);
    expect(opts.items[0].status).toBe("warning");
    expect(opts.items[0].details?.join("\n")).toContain("No automatic mutation performed");
    expect(opts.items.find((item) => item.item.quality_population === "historical")?.status).toBe("info");
    expect(opts.columns.map((column) => column.key)).toEqual(expect.arrayContaining(["score", "population", "band", "signals"]));
  });
});
