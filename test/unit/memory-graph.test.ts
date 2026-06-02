import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendEvidenceRecord } from "../../src/evidence";
import { unsafeAddMemoryRecord, loadAllRecords } from "../../src/store";
import { appendDeletionTombstone, createDeletionTombstone } from "../../src/tombstones";
import { appendInquiryRecord, createInquiryRecord } from "../../src/inquiries";
import { exportMemoryGraph } from "../../src/memory-graph";
import type { MemoryRecord } from "../../src/types";

function root(): string { const r = mkdtempSync(join(tmpdir(), "pi-graph-")); ensureMemoryDirs(r); return r; }
function rec(id: string, evidenceRef = "ev1", opts: Partial<MemoryRecord> = {}): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["test"], statement: "Use bun.", evidence: [{ type: "manual", ref: evidenceRef, note: "support" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-05-01", updated_at: "2026-05-01", review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If contradicted." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null, ...opts }; }

describe("memory graph", () => {
  test("exports memory evidence and inquiry edges without mutation", () => {
    const r = root();
    appendEvidenceRecord(r, { id: "ev1", resource_id: "r", profile_id: "p", created_at: "2026-05-01", source_kind: "conversation", source_summary: "summary", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem1"], redaction_status: "none" });
    unsafeAddMemoryRecord(r, rec("mem1"));
    appendInquiryRecord(r, createInquiryRecord({ question: "Which memory?", context: "ctx", related_memory_ids: ["mem1"], now: "2026-05-02T00:00:00Z" }));
    const before = loadAllRecords(r).length;
    const graph = exportMemoryGraph(r);
    expect(graph.nodes.some((n) => n.id === "memory_record:mem1")).toBe(true);
    expect(graph.nodes.some((n) => n.id === "evidence_record:ev1")).toBe(true);
    expect(graph.edges.some((e) => e.type === "supported_by" && e.from === "memory_record:mem1" && e.to === "evidence_record:ev1")).toBe(true);
    expect(graph.edges.some((e) => e.type === "related_to" && e.to === "memory_record:mem1")).toBe(true);
    expect(loadAllRecords(r)).toHaveLength(before);
    rmSync(r, { recursive: true, force: true });
  });

  test("exports supersession and tombstone edges", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("old", "ev-old", { status: "superseded", superseded_by: ["new"] }));
    unsafeAddMemoryRecord(r, rec("new", "ev-new", { supersedes: ["old"] }));
    appendDeletionTombstone(r, createDeletionTombstone({ deleted_record_id: "old", deletion_mode: "audit_preserving", deletion_reason: "invalid", now: "2026-05-03T00:00:00Z" }));
    const graph = exportMemoryGraph(r);
    expect(graph.edges.some((e) => e.type === "supersedes" && e.from === "memory_record:new" && e.to === "memory_record:old")).toBe(true);
    expect(graph.edges.some((e) => e.type === "tombstoned_by" && e.from === "memory_record:old")).toBe(true);
    rmSync(r, { recursive: true, force: true });
  });

  test("redacts raw secrets in graph payload", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem1", "ev1", { statement: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD" }));
    const text = JSON.stringify(exportMemoryGraph(r));
    expect(text).toContain("[redacted_secret:github_token]");
    expect(text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD");
    rmSync(r, { recursive: true, force: true });
  });
});
