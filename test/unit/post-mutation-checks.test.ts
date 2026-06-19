import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendEvidenceRecord } from "../../src/evidence";
import { applyPatch } from "../../src/patch";
import { readRecentRuntimeEvents } from "../../src/runtime-events";
import { unsafeAddMemoryRecord } from "../../src/store";
import { readDeletionTombstones } from "../../src/tombstones";
import { runPostMutationChecks, runFtsAwarePostMutationChecksAfterSync } from "../../src/post-mutation-checks";
import type { EvidenceRecord, MemoryPatch, MemoryRecord, PatchOp } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-post-mut-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem_sensitive",
    layer: "L2",
    scope: { type: "global" },
    tags: ["testing", "secret"],
    statement: "Never store customer token sk-12345678901234567890.",
    evidence: [{ type: "manual", ref: "ev_sensitive", note: "customer token sk-12345678901234567890" }],
    confidence: 0.95,
    stability: "semi-stable",
    created_at: "2026-06-19",
    updated_at: "2026-06-19",
    review: { cadence_days: 30, next_review: "2026-07-19", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "avoid_pattern",
    ...overrides,
  };
}

function evidence(): EvidenceRecord {
  return {
    id: "ev_sensitive",
    resource_id: "user:redacted",
    profile_id: "project:redacted",
    created_at: "2026-06-19T10:00:00.000Z",
    source_kind: "conversation",
    source_ref: "message",
    source_summary: "customer token sk-12345678901234567890",
    source_excerpt: "Never store customer token sk-12345678901234567890.",
    trust_class: "direct_user_instruction",
    polarity: "supports",
    related_memory_ids: ["mem_sensitive"],
  };
}

function patch(op: PatchOp): MemoryPatch {
  return {
    patch_id: "patch_post_mutation",
    created_at: "2026-06-19T10:00:00.000Z",
    generated_by: "manual",
    mode: "propose",
    summary: "post mutation test",
    ops: [op],
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}

describe("post-mutation integrity checks", () => {
  test("valid add patch produces no findings", () => {
    const dir = root();
    const op: PatchOp = { op_id: "op_add", op: "add", record: record({ id: "mem_added", statement: "Always use bun test." }), risk: "low", default_selected: true };
    applyPatch(dir, patch(op), { selectedOpIds: ["op_add"], now: "2026-06-19T10:00:00.000Z" });

    const findings = runPostMutationChecks({ root: dir, patchId: "patch_post_mutation", ops: [op], affectedRecordIds: ["mem_added"], mode: "normal" });

    expect(findings).toEqual([]);
  });

  test("privacy purge checks redacted statement, redacted evidence, content-free tombstone, and rendered projection", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    appendEvidenceRecord(dir, evidence());
    const op: PatchOp = { op_id: "op_delete", op: "delete", target_id: "mem_sensitive", deletion_mode: "privacy_purge", deletion_reason: "privacy_sensitive", risk: "high", default_selected: true };
    applyPatch(dir, patch(op), { selectedOpIds: ["op_delete"], now: "2026-06-19T10:00:00.000Z" });

    const findings = runPostMutationChecks({ root: dir, patchId: "patch_post_mutation", ops: [op], affectedRecordIds: ["mem_sensitive"], mode: "privacy_purge" });

    expect(findings).toEqual([]);
    expect(readDeletionTombstones(dir)[0].content_hash).toBeDefined();
    expect(JSON.stringify(readDeletionTombstones(dir))).not.toContain("sk-12345678901234567890");
    expect(readFileSync(join(dir, "rendered", "MEMORY.md"), "utf-8")).not.toContain("sk-12345678901234567890");
  });

  test("missing affected record after patch is reported as high severity runtime event without throwing", () => {
    const dir = root();
    const findings = runPostMutationChecks({ root: dir, patchId: "patch_missing", ops: [{ op_id: "op_update", op: "update", target_id: "mem_missing", updates: { confidence: 0.8 }, risk: "low", default_selected: true }], affectedRecordIds: ["mem_missing"], mode: "normal" });

    expect(findings.some((finding) => finding.code === "affected_record_missing" && finding.severity === "error")).toBe(true);
    const events = readRecentRuntimeEvents(dir, { minSeverity: "high" });
    expect(events.some((event) => event.component === "post-mutation" && event.message.includes("patch_missing"))).toBe(true);
  });

  test("checker failures are converted to runtime events and do not roll back patch result", () => {
    const dir = root();
    const findings = runPostMutationChecks({ root: dir, patchId: "patch_failure", ops: [], affectedRecordIds: [], mode: "normal", ftsIndex: { search: () => { throw new Error("boom sk-12345678901234567890"); } } });

    expect(findings.some((finding) => finding.code === "post_mutation_check_failed")).toBe(true);
    const eventText = JSON.stringify(readRecentRuntimeEvents(dir, { minSeverity: "high" }));
    expect(eventText).toContain("post-mutation");
    expect(eventText).not.toContain("sk-12345678901234567890");
  });

  test("post-patch checker without ftsIndex does not emit FTS findings", () => {
    const dir = root();
    const op: PatchOp = { op_id: "op_add", op: "add", record: record({ id: "mem_fts", statement: "Use post sync checks." }), risk: "low", default_selected: true };
    applyPatch(dir, patch(op), { selectedOpIds: ["op_add"], now: "2026-06-19T10:00:00.000Z" });

    const findings = runPostMutationChecks({ root: dir, patchId: "patch_no_fts", ops: [op], affectedRecordIds: ["mem_fts"], mode: "normal" });

    expect(findings.some((finding) => finding.code.startsWith("fts_"))).toBe(false);
  });

  test("post-sync FTS-aware checker emits fts_missing_active_record as medium runtime event", () => {
    const dir = root();
    const op: PatchOp = { op_id: "op_add", op: "add", record: record({ id: "mem_fts_missing", statement: "Use FTS-aware post mutation checks." }), risk: "low", default_selected: true };
    applyPatch(dir, patch(op), { selectedOpIds: ["op_add"], now: "2026-06-19T10:00:00.000Z" });

    const findings = runFtsAwarePostMutationChecksAfterSync({
      root: dir,
      patchId: "patch_fts_missing",
      ops: [op],
      ftsIndex: { search: (query: string) => query === "__post_mutation_probe__" ? [] : [{ id: "other", statement: "wrong" }] },
    });

    expect(findings).toContainEqual(expect.objectContaining({ code: "fts_missing_active_record", severity: "warning", record_id: "mem_fts_missing" }));
    const events = readRecentRuntimeEvents(dir, { minSeverity: "medium" });
    expect(events.some((event) => event.component === "post-mutation" && event.severity === "medium" && event.message.includes("post_fts_sync"))).toBe(true);
  });

  test("post-sync FTS-aware checker failure is diagnostic only", () => {
    const dir = root();
    const op: PatchOp = { op_id: "op_add", op: "add", record: record({ id: "mem_fts_failure", statement: "FTS failure should not rollback." }), risk: "low", default_selected: true };
    const applied = applyPatch(dir, patch(op), { selectedOpIds: ["op_add"], now: "2026-06-19T10:00:00.000Z" });

    const findings = runFtsAwarePostMutationChecksAfterSync({ root: dir, patchId: "patch_fts_failure", ops: [op], ftsIndex: { search: () => { throw new Error("fts boom sk-12345678901234567890"); } } });

    expect(applied.applied_ops).toEqual(["op_add"]);
    expect(findings.some((finding) => finding.code === "post_mutation_check_failed")).toBe(true);
    const eventText = JSON.stringify(readRecentRuntimeEvents(dir, { minSeverity: "high" }));
    expect(eventText).not.toContain("sk-12345678901234567890");
  });

  test("post-sync FTS-aware checker does not duplicate non-FTS findings", () => {
    const dir = root();
    const findings = runFtsAwarePostMutationChecksAfterSync({
      root: dir,
      patchId: "patch_missing_post_sync",
      ops: [{ op_id: "op_update", op: "update", target_id: "mem_missing", updates: { confidence: 0.8 }, risk: "low", default_selected: true }],
      ftsIndex: { search: () => [] },
    });

    expect(findings.some((finding) => finding.code === "affected_record_missing")).toBe(false);
    expect(readRecentRuntimeEvents(dir, { minSeverity: "high" })).toEqual([]);
  });
});
