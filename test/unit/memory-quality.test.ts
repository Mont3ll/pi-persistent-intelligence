import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvidenceRecord } from "../../src/evidence";
import { analyzeMemoryQuality, renderMemoryQualityReport } from "../../src/memory-quality";
import { ensureMemoryDirs } from "../../src/paths";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

function root(): string {
  const r = mkdtempSync(join(tmpdir(), "pi-memory-quality-"));
  ensureMemoryDirs(r);
  return r;
}

function rec(id: string, statement: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["quality"],
    statement,
    evidence: [{ type: "manual", ref: "ev_good", note: "support" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    review: { cadence_days: 30, next_review: "2026-08-01", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...overrides,
  };
}

describe("memory quality analyzer", () => {
  test("scores memory lifecycle quality and never mutates durable memory", () => {
    const r = root();
    appendEvidenceRecord(r, { id: "ev_good", resource_id: "res", profile_id: "default", created_at: "2026-07-01", source_kind: "conversation", source_summary: "supported", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_good"], redaction_status: "none" });
    appendEvidenceRecord(r, { id: "ev_redacted", resource_id: "res", profile_id: "default", created_at: "2026-01-01", source_kind: "conversation", source_summary: "redacted", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_weak"], redaction_status: "redacted" });
    unsafeAddMemoryRecord(r, rec("mem_good", "Use deterministic quality reports."));
    unsafeAddMemoryRecord(r, rec("mem_weak", "Maybe use old flow.", { confidence: 0.45, updated_at: "2025-01-01T00:00:00Z", evidence: [{ type: "manual", ref: "ev_redacted", note: "redacted" }] }));
    unsafeAddMemoryRecord(r, rec("mem_dup_a", "Use bun test.", { normalized_key: "workflow:test" } as Partial<MemoryRecord>));
    unsafeAddMemoryRecord(r, rec("mem_dup_b", "Use bun test.", { normalized_key: "workflow:test" } as Partial<MemoryRecord>));
    unsafeAddMemoryRecord(r, rec("mem_contested", "Review this guidance.", { status: "contested" }));
    unsafeAddMemoryRecord(r, rec("mem_superseded", "Use npm test.", { status: "superseded", superseded_by: ["mem_good"] }));
    unsafeAddMemoryRecord(r, rec("mem_deleted", "Deleted guidance.", { status: "deleted" }));
    const before = JSON.stringify(loadAllRecords(r));

    const report = analyzeMemoryQuality(r, { now: "2026-07-07T00:00:00Z" });

    expect(report.summary.total_records).toBe(7);
    expect(report.summary.active_record_count).toBe(4);
    expect(report.summary.review_record_count).toBe(1);
    expect(report.summary.historical_record_count).toBe(2);
    expect(report.heuristic_version).toBe("memory-quality-v3");
    expect(report.summary.structured_evidence_adoption_ratio).toBe(1);
    expect(report.summary.unresolved_legacy_evidence_count).toBe(0);
    expect(report.items.find((item) => item.memory_id === "mem_good")?.quality_score).toBeGreaterThan(80);
    expect(report.items.find((item) => item.memory_id === "mem_weak")?.lifecycle_state).toBe("stale");
    expect(report.items.find((item) => item.memory_id === "mem_dup_a")?.signals).toContain("duplicate_normalized_key");
    expect(report.items.find((item) => item.memory_id === "mem_superseded")?.lifecycle_state).toBe("superseded");
    expect(report.items.find((item) => item.memory_id === "mem_deleted")?.quality_population).toBe("historical");
    expect(report.recommendations.some((item) => item.memory_id === "mem_deleted")).toBe(false);
    expect(report.recommendations.length).toBeGreaterThanOrEqual(2);
    expect(report.recommendations.every((rec) => rec.review_required && rec.mutation_performed === false)).toBe(true);
    expect(JSON.stringify(loadAllRecords(r))).toBe(before);
    expect(renderMemoryQualityReport(report)).toContain("No automatic mutation performed");
    rmSync(r, { recursive: true, force: true });
  });

  test("retains historical inventory without depressing active quality", () => {
    const r = root();
    appendEvidenceRecord(r, { id: "ev_good", resource_id: "res", profile_id: "default", created_at: "2026-07-01", source_kind: "conversation", source_summary: "supported", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_active"], redaction_status: "none" });
    unsafeAddMemoryRecord(r, rec("mem_active", "Current healthy guidance."));
    for (let index = 0; index < 5; index++) {
      unsafeAddMemoryRecord(r, rec(`mem_deleted_${index}`, `Deleted guidance ${index}.`, { status: "deleted" }));
    }

    const report = analyzeMemoryQuality(r, { now: "2026-07-07T00:00:00Z" });

    expect(report.summary.total_records).toBe(6);
    expect(report.summary.active_record_count).toBe(1);
    expect(report.summary.historical_record_count).toBe(5);
    expect(report.summary.average_quality).toBeGreaterThan(80);
    expect(report.summary.low_quality_count).toBe(0);
    expect(report.recommendations).toHaveLength(0);
    expect(report.items).toHaveLength(6);
    rmSync(r, { recursive: true, force: true });
  });
});
