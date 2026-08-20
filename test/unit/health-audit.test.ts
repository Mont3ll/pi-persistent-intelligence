import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendEvidenceRecord } from "../../src/evidence";
import { appendRuntimeEvent } from "../../src/runtime-events";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import { readHealthAuditSnapshots, runMemoryHealthAudit, saveHealthAuditReport } from "../../src/health-audit";
import type { MemoryRecord } from "../../src/types";

function root(): string {
  const r = mkdtempSync(join(tmpdir(), "pi-health-audit-"));
  ensureMemoryDirs(r);
  return r;
}

function record(id: string, statement: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["testing"],
    statement,
    evidence: [{ type: "manual", ref: "ev_ok", note: "support" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    review: { cadence_days: 30, next_review: "2026-07-01", change_condition: "If tooling changes." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...overrides,
  };
}

describe("memory health audit", () => {
  test("builds an explainable report and does not mutate durable memory", () => {
    const r = root();
    unsafeAddMemoryRecord(r, record("mem_a", "Use bun test for this repository."));
    unsafeAddMemoryRecord(r, record("mem_deleted", "Retained historical guidance.", { status: "deleted", evidence: [{ type: "manual", ref: "ev_missing", note: "historical missing support" }] }));
    appendEvidenceRecord(r, { id: "ev_ok", resource_id: "res", profile_id: "default", created_at: "2026-06-01", source_kind: "conversation", source_summary: "User said to use bun test.", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_a"], redaction_status: "none" });
    const before = JSON.stringify(loadAllRecords(r));

    const report = runMemoryHealthAudit(r, { now: "2026-07-07T00:00:00Z" });

    expect(report.generated_at).toBe("2026-07-07T00:00:00Z");
    expect(report.health_score.overall).toBeGreaterThan(0);
    expect(report.categories.map((c) => c.id)).toContain("governance");
    expect(report.categories.map((c) => c.id)).toContain("relationship_quality");
    expect(report.snapshot.active_memories).toBe(1);
    expect(report.store_quality?.overall_score).toBeGreaterThan(0);
    expect(report.store_quality?.inputs).toMatchObject({ total_memory_records: 2, active_memories: 1, historical_memories: 1 });
    expect(report.store_quality?.metrics.find((metric) => metric.id === "memory_quality")?.score).toBeGreaterThan(80);
    expect(report.findings.filter((finding) => finding.category === "memory_quality" || finding.category === "relationship_quality").every((finding) => !finding.affected_ids.includes("mem_deleted") && !finding.affected_ids.some((id) => id.includes("mem_deleted")))).toBe(true);
    expect(report.findings.every((finding) => finding.mutation_performed === false)).toBe(true);
    expect(JSON.stringify(loadAllRecords(r))).toBe(before);
    rmSync(r, { recursive: true, force: true });
  });

  test("detects duplicate keys, orphan evidence, low confidence memories, stale inbox, and runtime warnings", () => {
    const r = root();
    unsafeAddMemoryRecord(r, record("mem_a", "Prefer bun test.", { confidence: 0.55, normalized_key: "tooling:test" } as Partial<MemoryRecord>));
    unsafeAddMemoryRecord(r, record("mem_b", "Prefer bun test.", { normalized_key: "tooling:test" } as Partial<MemoryRecord>));
    appendEvidenceRecord(r, { id: "ev_orphan", resource_id: "res", profile_id: "default", created_at: "2026-06-01", source_kind: "conversation", source_summary: "orphan", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["missing_mem"], redaction_status: "none" });
    writeFileSync(join(r, "inbox", "captured.jsonl"), `${JSON.stringify({ id: "cap_old", created_at: "2026-05-01T00:00:00Z", source: { type: "manual", ref: "test" }, text: "old candidate", tags: [], evidence_refs: [], status: "new" })}\n`);
    appendRuntimeEvent(r, { type: "warn", severity: "medium", component: "background", message: "slow job", timestamp: "2026-07-06T00:00:00Z" });

    const report = runMemoryHealthAudit(r, { now: "2026-07-07T00:00:00Z" });
    const codes = report.findings.map((finding) => finding.code);

    expect(codes).toContain("duplicate_normalized_key");
    expect(codes).toContain("orphan_evidence");
    expect(codes).toContain("low_confidence_active_memory");
    expect(codes).toContain("stale_inbox_candidate");
    expect(codes).toContain("recent_runtime_warnings");
    expect(codes).toContain("low_quality_memory");
    expect(codes).toContain("weak_memory_relationship");
    expect(report.recommendations.length).toBeGreaterThanOrEqual(5);
    expect(report.recommendations.every((rec) => rec.review_required && rec.mutation_performed === false)).toBe(true);
    rmSync(r, { recursive: true, force: true });
  });

  test("persists diagnostic snapshots and reports score trends", () => {
    const r = root();
    unsafeAddMemoryRecord(r, record("mem_a", "Use bun test."));
    const first = runMemoryHealthAudit(r, { now: "2026-07-07T00:00:00Z" });
    const firstPaths = saveHealthAuditReport(r, first);
    unsafeAddMemoryRecord(r, record("mem_b", "Use bun test.", { normalized_key: "same" } as Partial<MemoryRecord>));
    unsafeAddMemoryRecord(r, record("mem_c", "Use bun test.", { normalized_key: "same" } as Partial<MemoryRecord>));

    const second = runMemoryHealthAudit(r, { now: "2026-07-08T00:00:00Z" });
    const secondPaths = saveHealthAuditReport(r, second);
    const snapshots = readHealthAuditSnapshots(r);

    expect(existsSync(firstPaths.markdownPath)).toBe(true);
    expect(existsSync(secondPaths.jsonPath)).toBe(true);
    const savedMarkdown = readFileSync(secondPaths.markdownPath, "utf-8");
    expect(savedMarkdown).toContain("Store quality:");
    expect(savedMarkdown).toContain("No automatic mutation performed");
    expect(snapshots).toHaveLength(2);
    expect(second.trend?.previous_timestamp).toBe("2026-07-07T00:00:00Z");
    expect(second.trend?.duplicates_delta).toBeGreaterThan(0);
    rmSync(r, { recursive: true, force: true });
  });
});
