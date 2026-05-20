import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendEvidenceRecord, createEvidenceId, findEvidenceById, readEvidenceRecords } from "../../src/evidence";
import type { EvidenceRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-evidence-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "ev_test",
    resource_id: "user:test",
    profile_id: "project:test",
    thread_id: "thread-1",
    created_at: "2026-05-19T10:00:00.000Z",
    source_kind: "conversation",
    source_session_id: "session-1",
    source_ref: "message-1",
    source_summary: "User corrected the workflow.",
    source_excerpt: "Please do not use npm here; use bun for local tests.",
    excerpt_hash: "hash",
    redaction_status: "none",
    trust_class: "user_correction",
    polarity: "supports",
    durability_signal: "project",
    related_memory_ids: [],
    tags: ["testing"],
    ...overrides,
  };
}

describe("evidence store", () => {
  test("createEvidenceId is deterministic and normalizes whitespace", () => {
    const a = createEvidenceId({ profile_id: "project:test", thread_id: "thread-1", source_kind: "conversation", source_ref: "message-1", source_excerpt: "Use bun\nfor tests." });
    const b = createEvidenceId({ profile_id: "project:test", thread_id: "thread-1", source_kind: "conversation", source_ref: "message-1", source_excerpt: "  Use   bun for   tests. " });
    const c = createEvidenceId({ profile_id: "project:test", thread_id: "thread-2", source_kind: "conversation", source_ref: "message-1", source_excerpt: "Use bun for tests." });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(32);
  });

  test("append/read/find evidence records and bounds summary/excerpt", () => {
    const dir = root();
    const longExcerpt = "x".repeat(1200);
    const longSummary = "s".repeat(400);
    const record = appendEvidenceRecord(dir, evidence({ id: "", source_excerpt: longExcerpt, source_summary: longSummary }));

    expect(record.id).toHaveLength(32);
    expect(record.source_excerpt?.length).toBe(1000);
    expect(record.source_summary.length).toBe(300);
    expect(readEvidenceRecords(dir)).toHaveLength(1);
    expect(findEvidenceById(dir, record.id)?.id).toBe(record.id);
    expect(findEvidenceById(dir, "missing")).toBeNull();
  });
});
