import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvidenceRecord, readEvidenceRecords } from "../../src/evidence";
import { exportMemoryGraph } from "../../src/memory-graph";
import { ensureMemoryDirs } from "../../src/paths";
import { analyzeRelationshipQuality, analyzeRelationshipQualityFromGraph, renderRelationshipQualityReport } from "../../src/relationship-quality";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

function root(): string {
  const r = mkdtempSync(join(tmpdir(), "pi-relationship-quality-"));
  ensureMemoryDirs(r);
  return r;
}

function rec(id: string, statement: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["relationship-quality"],
    statement,
    evidence: [{ type: "manual", ref: "ev_live", note: "support" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    review: { cadence_days: 30, next_review: "2026-07-01", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...overrides,
  };
}

describe("relationship quality analyzer", () => {
  test("scores relationship health and never mutates durable memory", () => {
    const r = root();
    appendEvidenceRecord(r, { id: "ev_live", resource_id: "res", profile_id: "default", created_at: "2026-06-01", source_kind: "conversation", source_summary: "live support", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_hub"], redaction_status: "none" });
    appendEvidenceRecord(r, { id: "ev_redacted", resource_id: "res", profile_id: "default", created_at: "2026-06-01", source_kind: "conversation", source_summary: "redacted support", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_weak"], redaction_status: "redacted" });
    appendEvidenceRecord(r, { id: "ev_contra", resource_id: "res", profile_id: "default", created_at: "2026-06-02", source_kind: "conversation", source_summary: "contradiction", trust_class: "user_correction", polarity: "contradicts", related_memory_ids: ["mem_weak"], redaction_status: "none" });
    appendEvidenceRecord(r, { id: "ev_orphan", resource_id: "res", profile_id: "default", created_at: "2026-06-03", source_kind: "conversation", source_summary: "orphan redacted", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_orphan"], redaction_status: "redacted" });
    unsafeAddMemoryRecord(r, rec("mem_hub", "Hub memory supersedes old guidance.", { supersedes: ["mem_old"] }));
    unsafeAddMemoryRecord(r, rec("mem_old", "Old guidance.", { status: "superseded", superseded_by: ["mem_hub"] }));
    unsafeAddMemoryRecord(r, rec("mem_weak", "Weakly supported guidance.", { confidence: 0.6, evidence: [{ type: "manual", ref: "ev_redacted", note: "redacted" }] }));
    unsafeAddMemoryRecord(r, rec("mem_orphan", "Standalone fact.", { evidence: [{ type: "manual", ref: "ev_orphan", note: "redacted" }] }));
    const before = JSON.stringify(loadAllRecords(r));

    const report = analyzeRelationshipQuality(r, { now: "2026-07-07T00:00:00Z" });

    expect(report.summary.total_edges).toBeGreaterThanOrEqual(5);
    expect(report.summary.weak_edge_count).toBeGreaterThanOrEqual(1);
    expect(report.summary.orphan_memory_count).toBe(1);
    expect(report.summary.dangling_edge_count).toBe(0);
    expect(report.summary.cyclic_memory_pair_count).toBe(0);
    expect(report.memory_nodes.find((node) => node.memory_id === "mem_orphan")?.signals).toContain("orphan_memory");
    expect(report.relationships.find((edge) => edge.to === "evidence_record:ev_redacted")?.signals).toContain("redacted_or_deleted_evidence");
    expect(report.relationships.find((edge) => edge.type === "contradicted_by")?.quality_band).toBe("weak");
    expect(report.recommendations.every((rec) => rec.review_required && rec.mutation_performed === false)).toBe(true);
    const contextReport = analyzeRelationshipQualityFromGraph({ generated_at: "2026-07-07T00:00:00Z", graph: exportMemoryGraph(r, "2026-07-07T00:00:00Z"), records: loadAllRecords(r), evidence: readEvidenceRecords(r) });
    expect(contextReport.summary).toEqual(report.summary);
    expect(report.mutation_performed).toBe(false);
    expect(JSON.stringify(loadAllRecords(r))).toBe(before);
    expect(renderRelationshipQualityReport(report)).toContain("No automatic mutation performed");
    rmSync(r, { recursive: true, force: true });
  });
});
