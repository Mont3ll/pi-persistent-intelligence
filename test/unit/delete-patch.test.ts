import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendEvidenceRecord, findEvidenceById } from "../../src/evidence";
import { applyPatch } from "../../src/patch";
import { readRuntimeContext, buildRetrievalContext, syncFtsIndex } from "../../src/retriever";
import { renderMemoryToDisk } from "../../src/render";
import { extractHardRules } from "../../src/rules";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import { isTombstonedRecord, readDeletionTombstones } from "../../src/tombstones";
import { MemoryFtsIndex } from "../../src/search/fts";
import type { EvidenceRecord, MemoryPatch, MemoryRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-delete-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem_delete",
    layer: "L2",
    scope: { type: "global" },
    tags: ["correction"],
    statement: "Never expose secret token abc123.",
    evidence: [{ type: "manual", ref: "daily", note: "secret token abc123" }],
    confidence: 0.95,
    stability: "semi-stable",
    created_at: "2026-05-19",
    updated_at: "2026-05-19",
    review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "avoid_pattern",
    ...overrides,
  };
}

function evidence(id = "ev_1"): EvidenceRecord {
  return {
    id,
    resource_id: "user:test",
    profile_id: "project:test",
    created_at: "2026-05-19T10:00:00.000Z",
    source_kind: "conversation",
    source_ref: "message",
    source_summary: "secret token abc123 was mentioned",
    source_excerpt: "Never expose secret token abc123.",
    trust_class: "direct_user_instruction",
    polarity: "supports",
    related_memory_ids: ["mem_delete"],
  };
}

function patch(mode: "audit_preserving" | "privacy_purge"): MemoryPatch {
  return {
    patch_id: `patch_${mode}`,
    created_at: "2026-05-19T10:00:00.000Z",
    generated_by: "manual",
    mode: "propose",
    summary: "delete",
    ops: [{ op_id: "op_001", op: "delete", target_id: "mem_delete", deletion_mode: mode, deletion_reason: mode === "privacy_purge" ? "privacy_sensitive" : "invalid", reason: "delete test", risk: "high", default_selected: true }],
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}

describe("delete patch", () => {
  test("audit_preserving tombstones and excludes deleted records from retrieval/projection/hard rules", async () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    applyPatch(dir, patch("audit_preserving"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });

    const deleted = loadAllRecords(dir).find((item) => item.id === "mem_delete");
    expect(deleted?.status).toBe("deleted");
    expect(deleted?.statement).toContain("secret token");
    expect(isTombstonedRecord(dir, "mem_delete")).toBe(true);
    expect(extractHardRules(loadAllRecords(dir))).toHaveLength(0);

    const rendered = renderMemoryToDisk(dir);
    expect(rendered).not.toContain("secret token");

    const ctx = await buildRetrievalContext(dir, { prompt: "secret token", today: "2026-05-19", cwd: dir });
    expect(ctx.markdown).not.toContain("secret token");
    expect(readRuntimeContext(dir)).not.toContain("secret token");
  });

  test("privacy_purge removes normal record content and redacts linked evidence", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    appendEvidenceRecord(dir, evidence());
    applyPatch(dir, patch("privacy_purge"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });

    const purged = loadAllRecords(dir).find((item) => item.id === "mem_delete");
    expect(purged?.status).toBe("deleted");
    expect(purged?.statement).toBe("[deleted]");
    expect(JSON.stringify(purged)).not.toContain("abc123");
    expect(readDeletionTombstones(dir)[0].content_removed).toBe(true);

    const redacted = findEvidenceById(dir, "ev_1");
    expect(redacted?.redaction_status).toBe("deleted");
    expect(redacted?.source_summary).toBe("[deleted]");
    expect(redacted?.source_excerpt).toBeUndefined();
    expect(JSON.stringify(redacted)).not.toContain("abc123");
  });

  test("tombstoned record cannot be re-added through patch apply", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    applyPatch(dir, patch("privacy_purge"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });

    expect(() => applyPatch(dir, {
      patch_id: "patch_readd",
      created_at: "2026-05-19T10:00:00.000Z",
      generated_by: "manual",
      mode: "propose",
      summary: "readd",
      ops: [{ op_id: "op_001", op: "add", record: record(), risk: "low", default_selected: true }],
      status: "proposed",
      applied_at: null,
      applied_ops: [],
      skipped_ops: [],
    }, { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" })).toThrow(/tombstoned/);
  });

  test("search index rebuild excludes deleted records", () => {
    const dir = root();
    const fts = new MemoryFtsIndex(join(dir, "search", "memory-fts.db"));
    unsafeAddMemoryRecord(dir, record());
    syncFtsIndex(dir, fts);
    expect(fts.search("secret", 5)).toHaveLength(1);
    applyPatch(dir, patch("audit_preserving"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });
    syncFtsIndex(dir, fts);
    expect(fts.search("secret", 5)).toHaveLength(0);
    fts.close();
    expect(existsSync(join(dir, "rendered", "MEMORY.md"))).toBe(true);
    expect(readFileSync(join(dir, "rendered", "MEMORY.md"), "utf-8")).not.toContain("secret token");
  });
});
