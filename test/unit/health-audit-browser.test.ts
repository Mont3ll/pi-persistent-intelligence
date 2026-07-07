import { describe, expect, test } from "bun:test";
import { healthAuditBrowserOptions } from "../../src/tui/browser-adapters";
import type { MemoryHealthAuditReport } from "../../src/health-audit";

function report(): MemoryHealthAuditReport {
  return {
    generated_at: "2026-07-07T00:00:00Z",
    root: "/tmp/pi",
    health_score: { overall: 88, explanation: "category average" },
    categories: [
      { id: "governance", label: "Governance", score: 100, findings: 0, errors: 0, warnings: 0 },
      { id: "memory_quality", label: "Memory Quality", score: 80, findings: 2, errors: 0, warnings: 2 },
    ],
    findings: [{ code: "duplicate_normalized_key", category: "memory_quality", severity: "warning", reason: "duplicate", affected_ids: ["mem_a", "mem_b"], evidence_ids: [], mutation_performed: false }],
    recommendations: [{ id: "rec_1", category: "memory_quality", summary: "Review duplicate", reason: "duplicate", affected_ids: ["mem_a", "mem_b"], review_required: true, mutation_performed: false }],
    snapshot: { timestamp: "2026-07-07T00:00:00Z", active_memories: 2, candidate_count: 1, duplicates: 2, conflicts: 0, warnings: 1, errors: 0, governance_score: 100, overall_score: 88, runtime_warnings: 0 },
    trend: { previous_timestamp: "2026-07-06T00:00:00Z", overall_delta: -2, duplicates_delta: 2, conflicts_delta: 0, inbox_delta: 1, runtime_warnings_delta: 0 },
    mutation_performed: false,
  };
}

describe("health audit browser adapter", () => {
  test("renders category rows with recommendations and trend details", () => {
    const opts = healthAuditBrowserOptions(report());

    expect(opts.title).toContain("Health Audit");
    expect(opts.items).toHaveLength(2);
    expect(opts.items[1].searchText).toContain("duplicate_normalized_key");
    expect(opts.items[1].details?.join("\n")).toContain("No automatic mutation performed");
    expect(opts.items[1].details?.join("\n")).toContain("Trend");
  });
});
