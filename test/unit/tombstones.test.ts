import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendDeletionTombstone, createDeletionTombstone, isTombstonedRecord, readDeletionTombstones } from "../../src/tombstones";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-tomb-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

describe("deletion tombstones", () => {
  test("creates content-free tombstone for privacy purge", () => {
    const tombstone = createDeletionTombstone({
      resource_id: "user:test",
      profile_id: "project:test",
      deleted_record_id: "mem_sensitive",
      deletion_mode: "privacy_purge",
      deletion_reason: "privacy_sensitive",
      content: "secret memory text",
      now: "2026-05-19T10:00:00.000Z",
    });

    expect(tombstone.id).toContain("tomb_mem_sensitive_");
    expect(tombstone.deleted_record_id).toBe("mem_sensitive");
    expect(tombstone.content_removed).toBe(true);
    expect(tombstone.content_hash).toHaveLength(32);
    expect(JSON.stringify(tombstone)).not.toContain("secret memory text");
  });

  test("appends, reads, and checks tombstones", () => {
    const dir = root();
    const tombstone = appendDeletionTombstone(dir, createDeletionTombstone({ deleted_record_id: "mem_1", deletion_mode: "audit_preserving", deletion_reason: "invalid", now: "2026-05-19T10:00:00.000Z" }));

    expect(readDeletionTombstones(dir)).toHaveLength(1);
    expect(isTombstonedRecord(dir, "mem_1")).toBe(true);
    expect(isTombstonedRecord(dir, "mem_2")).toBe(false);
    expect(existsSync(join(dir, "memory", "tombstones.jsonl"))).toBe(true);
    expect(readFileSync(join(dir, "memory", "tombstones.jsonl"), "utf-8")).toContain(tombstone.id);
  });
});
