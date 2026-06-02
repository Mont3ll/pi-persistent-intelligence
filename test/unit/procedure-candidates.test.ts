import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord, loadAllRecords } from "../../src/store";
import { generateProcedureCandidates, saveProcedureCandidateReport } from "../../src/procedure-candidates";
import type { MemoryRecord } from "../../src/types";

function root(): string { const r = mkdtempSync(join(tmpdir(), "pi-proc-")); ensureMemoryDirs(r); return r; }
function rec(id: string, statement: string, opts: Partial<MemoryRecord> = {}): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["workflow", "testing"], statement, evidence: [{ type: "manual", ref: `ev_${id}`, note: "support" }], confidence: 0.9, stability: "stable", created_at: "2026-05-01", updated_at: "2026-05-01", review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If workflow changes." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null, ruleType: "workflow", ...opts }; }

describe("procedure candidates", () => {
  test("creates review-only candidate from repeated workflow records", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem1", "Run bun test before committing."));
    unsafeAddMemoryRecord(r, rec("mem2", "Run bun run typecheck before pushing."));
    const before = loadAllRecords(r).length;
    const report = generateProcedureCandidates(r, { minSourceRecords: 2 });
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0].requires_review).toBe(true);
    expect(report.candidates[0].source_memory_ids).toEqual(["mem1", "mem2"]);
    expect(loadAllRecords(r)).toHaveLength(before);
    rmSync(r, { recursive: true, force: true });
  });

  test("requires minimum source records and excludes contested deleted superseded", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem1", "Run bun test."));
    unsafeAddMemoryRecord(r, rec("mem2", "Run npm test.", { status: "contested" }));
    unsafeAddMemoryRecord(r, rec("mem3", "Run yarn test.", { status: "deleted" }));
    unsafeAddMemoryRecord(r, rec("mem4", "Run pnpm test.", { status: "superseded" }));
    const report = generateProcedureCandidates(r, { minSourceRecords: 2 });
    expect(report.candidates).toHaveLength(0);
    rmSync(r, { recursive: true, force: true });
  });

  test("redacts secrets and never writes skill files", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem1", "Run command with ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD."));
    unsafeAddMemoryRecord(r, rec("mem2", "Verify output after command."));
    const report = generateProcedureCandidates(r, { minSourceRecords: 2 });
    const text = JSON.stringify(report);
    expect(text).toContain("[redacted_secret:github_token]");
    const saved = saveProcedureCandidateReport(r, report);
    expect(saved.jsonPath).toContain("reports/procedure-candidates");
    expect(existsSync(join(r, "SKILL.md"))).toBe(false);
    rmSync(r, { recursive: true, force: true });
  });
});
