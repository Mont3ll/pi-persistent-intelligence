import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendEvidenceRecord, findEvidenceById } from "../../src/evidence";
import { applyPatch, readPatchFile } from "../../src/patch";
import { readRuntimeContext, buildRetrievalContext, syncFtsIndex } from "../../src/retriever";
import { renderMemoryToDisk } from "../../src/render";
import { extractHardRules } from "../../src/rules";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import { isTombstonedRecord, readDeletionTombstones } from "../../src/tombstones";
import { MemoryFtsIndex } from "../../src/search/fts";
import { runMemoryDiagnostics } from "../../src/diagnostics";
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

  test("privacy_purge removes a superseded terminal record while audit_preserving still rejects it", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record({ status: "superseded", scope: { type: "project", project: "secret-project-token" }, superseded_by: ["mem_replacement"] }));
    const audit = applyPatch(dir, patch("audit_preserving"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });
    expect(audit.skipped_ops).toContainEqual(expect.objectContaining({ op_id: "op_001", reason: "target_terminal" }));

    const purged = applyPatch(dir, patch("privacy_purge"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:01:00.000Z" });
    expect(purged.applied_ops).toEqual(["op_001"]);
    const deleted = loadAllRecords(dir).find((item) => item.id === "mem_delete");
    expect(deleted).toMatchObject({ status: "deleted", statement: "[deleted]", evidence: [expect.objectContaining({ type: "deletion" })] });
    expect(JSON.stringify(deleted)).not.toContain("secret token");
    expect(JSON.stringify(deleted)).not.toContain("secret-project-token");
    expect(readFileSync(ensureMemoryDirs(dir).memory.tombstones, "utf-8")).not.toContain("secret-project-token");
    expect(readDeletionTombstones(dir)[0]).toMatchObject({ deleted_record_id: "mem_delete", deletion_mode: "privacy_purge", content_removed: true });
    unsafeAddMemoryRecord(dir, record({ id: "mem_replacement", statement: "Safe replacement.", status: "active", supersedes: ["mem_delete"], superseded_by: [] }));
    renderMemoryToDisk(dir);
    expect(runMemoryDiagnostics(dir).findings.filter((finding) => finding.severity === "error")).toEqual([]);
  });

  test("privacy_purge also redacts correlated historical candidates and patch payloads", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    applyPatch(dir, patch("privacy_purge"), { selectedOpIds: ["op_001"], now: "2026-05-19T09:30:00.000Z" });
    const paths = ensureMemoryDirs(dir);
    const secret = "API_TOKEN=legacy-secret-value";
    writeFileSync(paths.inbox.captured, `${JSON.stringify({
      id: "candidate_arbitrary",
      created_at: "2026-05-19T09:00:00.000Z",
      source: { type: "manual", ref: "daily", cwd: "/secret/scope" },
      text: secret,
      tags: ["secret-tag"],
      evidence_refs: ["secret-evidence"],
      confidence: 0.9,
      status: "patched",
    })}\n${JSON.stringify({
      id: "candidate_direct_relationship",
      created_at: "2026-05-19T09:00:00.000Z",
      source: { type: "manual", ref: "daily" },
      text: secret,
      tags: ["secret-tag"],
      evidence_refs: ["secret-evidence"],
      matched_memory_ids: ["mem_delete"],
      status: "new",
    })}\n`);
    writeFileSync(join(paths.patches, "patch_historical.json"), `${JSON.stringify({
      patch_id: "patch_historical",
      created_at: "2026-05-19T09:00:00.000Z",
      generated_by: "curator",
      mode: "propose",
      summary: secret,
      ops: [{
        op_id: "op_historical",
        candidate_id: "candidate_arbitrary",
        op: "add",
        target: "memory/L2.playbooks.jsonl",
        record: record({ statement: secret }),
        rationale: secret,
        risk: "low",
        default_selected: true,
      }, {
        op_id: "op_sibling",
        candidate_id: "candidate_arbitrary",
        op: "flag_for_review",
        target_id: "unrelated_record",
        updates: { review: { cadence_days: 1, next_review: "2026-05-20", change_condition: secret } },
        rationale: secret,
        risk: "low",
        default_selected: false,
      }, {
        op_id: "op_relationship_only",
        candidate_id: "candidate_direct_relationship",
        op: "add",
        record: record({ id: "relationship_only_record", statement: secret }),
        rationale: secret,
        risk: "low",
        default_selected: false,
      }],
      status: "applied",
      applied_at: "2026-05-19T09:01:00.000Z",
      applied_ops: ["op_historical"],
      skipped_ops: [],
    }, null, 2)}\n`);

    const current = patch("privacy_purge");
    current.summary = secret;
    current.ops[0].reason = secret;
    current.ops.push({
      op_id: "op_reintroduce",
      candidate_id: "candidate_direct_relationship",
      op: "add",
      record: record({ id: "mem_reintroduced", statement: secret }),
      rationale: secret,
      risk: "low",
      default_selected: true,
    });
    const applied = applyPatch(dir, current, { selectedOpIds: ["op_001", "op_reintroduce"], now: "2026-05-19T10:00:00.000Z" });

    expect(applied.summary).toBe("[privacy purged]");
    expect(JSON.stringify(applied)).not.toContain(secret);
    expect(readFileSync(join(paths.patches, "patch_privacy_purge.json"), "utf-8")).not.toContain(secret);
    expect(readFileSync(paths.inbox.captured, "utf-8")).not.toContain(secret);
    expect(readFileSync(join(paths.patches, "patch_historical.json"), "utf-8")).not.toContain(secret);
    expect(readFileSync(paths.inbox.captured, "utf-8")).toContain("[privacy purged]");
    expect(readFileSync(join(paths.patches, "patch_historical.json"), "utf-8")).toContain("[privacy purged]");
    expect(loadAllRecords(dir).some((item) => item.id === "mem_reintroduced")).toBe(false);

    unsafeAddMemoryRecord(dir, record({ id: "unrelated_record", statement: "Unrelated safe record." }));
    const shell = readPatchFile(dir, "patch_historical");
    applyPatch(dir, shell, { selectedOpIds: ["op_sibling"], now: "2026-05-19T10:05:00.000Z" });
    expect(loadAllRecords(dir).find((item) => item.id === "unrelated_record")?.statement).toBe("Unrelated safe record.");
  });

  test("executes multiple selected privacy deletes even when they share a candidate", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    unsafeAddMemoryRecord(dir, record({ id: "mem_second", statement: "Second private record." }));
    const multi = patch("privacy_purge");
    multi.ops[0].candidate_id = "candidate_shared";
    multi.ops.push({
      op_id: "op_002",
      op: "delete",
      target_id: "mem_second",
      candidate_id: "candidate_shared",
      deletion_mode: "privacy_purge",
      deletion_reason: "privacy_sensitive",
      reason: "privacy cleanup",
      risk: "high",
      default_selected: true,
    });

    applyPatch(dir, multi, { selectedOpIds: ["op_001", "op_002"], now: "2026-05-19T10:00:00.000Z" });

    expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("deleted");
    expect(loadAllRecords(dir).find((item) => item.id === "mem_second")?.status).toBe("deleted");
  });

  test("preflights historical artifacts before a privacy mutation", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const paths = ensureMemoryDirs(dir);
    writeFileSync(join(paths.patches, "malformed.json"), `${JSON.stringify({ patch_id: "malformed", ops: [] })}\n`);
    writeFileSync(paths.inbox.captured, `${JSON.stringify({
      id: "bad_candidate",
      created_at: "2026-05-19T09:00:00.000Z",
      text: "safe",
      tags: [],
      evidence_refs: [],
      matched_memory_ids: "mem_delete",
      status: "new",
    })}\n`);

    expect(() => applyPatch(dir, patch("privacy_purge"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" })).toThrow();
    expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("active");
    expect(existsSync(join(paths.patches, "patch_privacy_purge.json"))).toBe(false);
  });

  test("rejects patch IDs containing path components before writing or mutating", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const malicious = patch("privacy_purge");
    malicious.patch_id = "../escaped";

    expect(() => applyPatch(dir, malicious, { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" })).toThrow("Invalid patch ID");
    expect(existsSync(join(dir, "escaped.json"))).toBe(false);
    expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("active");
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

    const result = applyPatch(dir, {
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
    }, { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });
    expect(result.applied_ops).toEqual([]);
    expect(result.skipped_ops).toContainEqual(expect.objectContaining({ op_id: "op_001", reason: "tombstoned" }));
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
