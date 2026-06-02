import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendEvidenceRecord } from "../../src/evidence";
import { unsafeAddMemoryRecord, loadAllRecords } from "../../src/store";
import { checkProvenanceLiveness } from "../../src/provenance-liveness";
import type { MemoryRecord } from "../../src/types";

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-live-"));
  ensureMemoryDirs(root);
  return root;
}

function rec(id: string, evidenceRef = "ev1", opts: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["test"],
    statement: "Use bun for tests.",
    evidence: [{ type: "manual", ref: evidenceRef, note: "support" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-05-01",
    updated_at: "2026-05-01",
    review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If repo changes." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...opts,
  };
}

describe("provenance liveness", () => {
  test("missing source file produces warning without mutation", () => {
    const root = tempRoot();
    const before = loadAllRecords(root).length;
    appendEvidenceRecord(root, {
      id: "ev1", resource_id: "r", profile_id: "p", created_at: "2026-05-01", source_kind: "file",
      source_file: join(root, "missing.md"), source_summary: "missing file", trust_class: "direct_user_instruction",
      polarity: "supports", related_memory_ids: ["mem1"], redaction_status: "none",
    });
    unsafeAddMemoryRecord(root, rec("mem1"));
    const result = checkProvenanceLiveness(root);
    expect(result.findings.some((f) => f.code === "source_file_missing" && f.memory_id === "mem1")).toBe(true);
    expect(loadAllRecords(root)).toHaveLength(before + 1);
    rmSync(root, { recursive: true, force: true });
  });

  test("redacted evidence produces reverify recommendation", () => {
    const root = tempRoot();
    appendEvidenceRecord(root, {
      id: "ev1", resource_id: "r", profile_id: "p", created_at: "2026-05-01", source_kind: "manual" as any,
      source_summary: "redacted", trust_class: "direct_user_instruction", polarity: "supports",
      related_memory_ids: ["mem1"], redaction_status: "redacted",
    });
    unsafeAddMemoryRecord(root, rec("mem1"));
    const result = checkProvenanceLiveness(root);
    expect(result.findings.some((f) => f.code === "evidence_redacted_or_deleted")).toBe(true);
    expect(result.reverification_memory_ids).toContain("mem1");
    rmSync(root, { recursive: true, force: true });
  });

  test("legacy records with non-structured evidence refs do not crash", () => {
    const root = tempRoot();
    unsafeAddMemoryRecord(root, rec("legacy", "daily/2026-05-01.md"));
    expect(() => checkProvenanceLiveness(root)).not.toThrow();
    rmSync(root, { recursive: true, force: true });
  });

  test("global memories are not falsely marked inactive", () => {
    const root = tempRoot();
    unsafeAddMemoryRecord(root, rec("global"));
    const result = checkProvenanceLiveness(root);
    expect(result.findings.some((f) => f.code === "project_scope_missing" && f.memory_id === "global")).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
