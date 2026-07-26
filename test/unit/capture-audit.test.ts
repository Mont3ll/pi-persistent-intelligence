import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditCaptureHistory, renderCaptureAuditReport } from "../../src/capture-audit";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

const dirs: string[] = [];
function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-capture-audit-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

function record(id: string, statement: string): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "project", project: "obsidian-vault" },
    tags: ["correction"],
    statement,
    evidence: [{ type: "manual", ref: "test", note: "test" }],
    confidence: 0.9,
    stability: "stable",
    created_at: "2026-07-01",
    updated_at: "2026-07-01",
    review: { cadence_days: 30, next_review: "2026-08-01", change_condition: "test" },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "correction",
  };
}

function canonicalSnapshot(dir: string): string[] {
  const paths = ensureMemoryDirs(dir);
  return [paths.memory.L1, paths.memory.L2, paths.inbox.captured, join(paths.memory.projects, "obsidian-vault.jsonl")]
    .map((path) => { try { return readFileSync(path, "utf-8"); } catch { return ""; } });
}

describe("capture audit", () => {
  test("finds a historical preference without mutation", () => {
    const dir = root();
    const summaries = join(dir, "sessions", "summaries");
    mkdirSync(summaries, { recursive: true });
    writeFileSync(join(summaries, "session.md"), "# Session\n\nDate: 2026-07-07\n\n- Avoid em dashes entirely.\n- For this response, keep it short.\n", "utf-8");
    const before = canonicalSnapshot(dir);
    const report = auditCaptureHistory(dir, { since: "2026-05-01", now: "2026-07-26T00:00:00Z" });
    expect(report.historical_preferences).toHaveLength(1);
    expect(report.historical_preferences[0].proposed_scope.type).toBe("global");
    expect(report.mutation_performed).toBe(false);
    expect(canonicalSnapshot(dir)).toEqual(before);
  });

  test("flags task wrappers and vault-mis-scoped global rules", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record("mem_wrapper", "Task: You are a delegated subagent. Implement this migration."));
    unsafeAddMemoryRecord(dir, record("mem_global_in_vault", "Across projects, keep public repositories free of development diary content."));
    const report = auditCaptureHistory(dir, { now: "2026-07-26T00:00:00Z" });
    expect(report.contaminated_record_ids).toContain("mem_wrapper");
    expect(report.rescope_proposals.map((item) => item.record_id)).toContain("mem_global_in_vault");
    expect(renderCaptureAuditReport(report)).toContain("Historical preferences");
  });
});
