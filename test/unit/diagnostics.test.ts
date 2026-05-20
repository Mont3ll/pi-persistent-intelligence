import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord } from "../../src/store";
import { appendEvidenceRecord } from "../../src/evidence";
import { appendDeletionTombstone, createDeletionTombstone } from "../../src/tombstones";
import { runMemoryDiagnostics } from "../../src/diagnostics";
import { MemoryFtsIndex } from "../../src/search/fts";
import { syncFtsIndex } from "../../src/retriever";
import type { MemoryRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-diag-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function record(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["workflow"],
    statement: `${id} use canonical JSONL.`,
    evidence: [{ type: "manual", ref: "ev_1", note: "n" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-05-20",
    updated_at: "2026-05-20",
    review: { cadence_days: 30, next_review: "2026-06-20", change_condition: "c" },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "workflow",
    ...overrides,
  };
}

describe("memory diagnostics", () => {
  test("passes clean on empty / fresh store", () => {
    const dir = root();
    const report = runMemoryDiagnostics(dir);
    expect(report.findings.filter((f) => f.severity === "error")).toHaveLength(0);
    expect(report.summary.errors).toBe(0);
  });

  test("passes clean on valid store with records", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record("mem_clean"));
    appendEvidenceRecord(dir, { id: "ev_1", resource_id: "u", profile_id: "p", created_at: "2026-05-20T00:00:00Z", source_kind: "conversation", source_ref: "m", source_summary: "s", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_clean"] });
    const report = runMemoryDiagnostics(dir);
    expect(report.findings.filter((f) => f.severity === "error")).toHaveLength(0);
  });

  test("detects orphan evidence IDs", () => {
    const dir = root();
    appendEvidenceRecord(dir, { id: "ev_orphan", resource_id: "u", profile_id: "p", created_at: "2026-05-20T00:00:00Z", source_kind: "conversation", source_ref: "m", source_summary: "s", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_nonexistent"] });
    const report = runMemoryDiagnostics(dir);
    expect(report.findings.some((f) => f.code === "orphan_evidence" && f.severity !== "ok")).toBe(true);
  });

  test("detects tombstoned record with active status (simulated)", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record("mem_zombied", { status: "active" }));
    appendDeletionTombstone(dir, createDeletionTombstone({ deleted_record_id: "mem_zombied", deletion_mode: "audit_preserving", deletion_reason: "invalid", now: "2026-05-20T00:00:00Z" }));
    const report = runMemoryDiagnostics(dir);
    expect(report.findings.some((f) => f.code === "tombstoned_in_active_store" && f.severity !== "ok")).toBe(true);
  });

  test("detects contested record in hard-rule path", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record("mem_contested", { status: "contested", ruleType: "avoid_pattern", confidence: 0.95 }));
    const report = runMemoryDiagnostics(dir);
    expect(report.findings.some((f) => f.code === "contested_in_hard_rule_candidate")).toBe(true);
  });

  test("reports legacy records info without failing", () => {
    const dir = root();
    const legacyRecord = record("mem_legacy");
    delete (legacyRecord as any).profile_id;
    delete (legacyRecord as any).normalized_key;
    unsafeAddMemoryRecord(dir, legacyRecord);
    const report = runMemoryDiagnostics(dir);
    expect(report.findings.filter((f) => f.severity === "error")).toHaveLength(0);
    expect(report.findings.some((f) => f.code === "legacy_missing_fields" && f.severity === "info")).toBe(true);
  });
});
