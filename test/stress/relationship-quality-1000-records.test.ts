import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvidenceRecord, readEvidenceRecords } from "../../src/evidence";
import { exportMemoryGraphFromContext } from "../../src/memory-graph";
import { ensureMemoryDirs } from "../../src/paths";
import { analyzeRelationshipQualityFromGraph } from "../../src/relationship-quality";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

function record(id: string, evidenceRef: string, supersedes: string[] = []): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["stress"],
    statement: `Stress memory ${id}`,
    evidence: [{ type: "manual", ref: evidenceRef, note: "support" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    review: { cadence_days: 30, next_review: "2026-08-01", change_condition: "If contradicted." },
    status: "active",
    supersedes,
    superseded_by: [],
    vault_ref: null,
  };
}

describe("relationship quality stress", () => {
  test("analyzes 1000 preloaded memory records under local latency target", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-rq-stress-"));
    ensureMemoryDirs(root);
    for (let i = 0; i < 1000; i++) {
      const memId = `mem_${i.toString().padStart(4, "0")}`;
      const evId = `ev_${i.toString().padStart(4, "0")}`;
      appendEvidenceRecord(root, { id: evId, resource_id: "stress", profile_id: "default", created_at: "2026-07-01T00:00:00Z", source_kind: "conversation", source_summary: `support ${i}`, trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: [memId], redaction_status: i % 100 === 0 ? "redacted" : "none" });
      unsafeAddMemoryRecord(root, record(memId, evId, i > 0 && i % 50 === 0 ? [`mem_${(i - 1).toString().padStart(4, "0")}`] : []));
    }
    const records = loadAllRecords(root);
    const evidence = readEvidenceRecords(root);
    const graph = exportMemoryGraphFromContext({ generated_at: "2026-07-09T00:00:00Z", memories: records, evidence });
    const before = JSON.stringify(records);

    const started = performance.now();
    const report = analyzeRelationshipQualityFromGraph({ generated_at: "2026-07-09T00:00:00Z", graph, records, evidence });
    const elapsed = performance.now() - started;

    expect(report.summary.total_edges).toBeGreaterThanOrEqual(2000);
    expect(report.summary.weak_edge_count).toBeGreaterThan(0);
    expect(report.mutation_performed).toBe(false);
    expect(JSON.stringify(loadAllRecords(root))).toBe(before);
    expect(elapsed).toBeLessThan(1000);
    rmSync(root, { recursive: true, force: true });
  });
});
