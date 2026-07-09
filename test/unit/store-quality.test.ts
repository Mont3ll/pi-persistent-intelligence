import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvidenceRecord } from "../../src/evidence";
import { ensureMemoryDirs } from "../../src/paths";
import { analyzeStoreQuality, renderStoreQualityReport } from "../../src/store-quality";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

function root(): string {
  const r = mkdtempSync(join(tmpdir(), "pi-store-quality-"));
  ensureMemoryDirs(r);
  return r;
}

function rec(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["store-quality"],
    statement: `Store quality memory ${id}`,
    evidence: [{ type: "manual", ref: "ev_live", note: "support" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    review: { cadence_days: 30, next_review: "2026-08-01", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...overrides,
  };
}

describe("store-wide quality dashboard", () => {
  test("computes report-only aggregate quality without mutating memory", () => {
    const r = root();
    appendEvidenceRecord(r, { id: "ev_live", resource_id: "res", profile_id: "default", created_at: "2026-07-01T00:00:00Z", source_kind: "conversation", source_summary: "live support", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_good"], redaction_status: "none" });
    appendEvidenceRecord(r, { id: "ev_redacted", resource_id: "res", profile_id: "default", created_at: "2026-07-01T00:00:00Z", source_kind: "conversation", source_summary: "redacted support", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_weak"], redaction_status: "redacted" });
    unsafeAddMemoryRecord(r, rec("mem_good"));
    unsafeAddMemoryRecord(r, rec("mem_weak", { confidence: 0.55, evidence: [{ type: "manual", ref: "ev_redacted", note: "redacted" }] }));
    const before = JSON.stringify(loadAllRecords(r));

    const report = analyzeStoreQuality(r, { now: "2026-07-09T00:00:00Z" });

    expect(report.generated_at).toBe("2026-07-09T00:00:00Z");
    expect(report.overall_score).toBeLessThan(100);
    expect(report.metrics.map((metric) => metric.id)).toEqual(expect.arrayContaining(["memory_quality", "relationship_quality", "recall_effectiveness", "governance", "inbox", "runtime"]));
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.recommendations.every((rec) => rec.review_required && rec.mutation_performed === false)).toBe(true);
    expect(report.mutation_performed).toBe(false);
    expect(JSON.stringify(loadAllRecords(r))).toBe(before);
    expect(renderStoreQualityReport(report)).toContain("No automatic mutation performed");
    rmSync(r, { recursive: true, force: true });
  });
});
