import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord } from "../../src/store";
import { generateProcedureCandidates } from "../../src/procedure-candidates";
import type { MemoryRecord } from "../../src/types";

function rec(id: string): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["workflow"], statement: `Always run sprint step ${id} with review.`, evidence: [{ type: "manual", ref: `ev_${id}`, note: "support" }], confidence: 0.9, stability: "stable", created_at: "2026-06-01", updated_at: "2026-06-01", review: { cadence_days: 30, next_review: "2026-07-01", change_condition: "If process changes." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null }; }

describe("procedure candidate export boundary", () => {
  test("procedure candidates remain review-only and default to not_exported", () => {
    const r = mkdtempSync(join(tmpdir(), "pi-proc-boundary-")); ensureMemoryDirs(r);
    unsafeAddMemoryRecord(r, rec("mem_a")); unsafeAddMemoryRecord(r, rec("mem_b"));
    const report = generateProcedureCandidates(r, { now: "2026-06-01T00:00:00Z", minSourceRecords: 2 });
    expect(report.candidates[0].requires_human_review).toBe(true);
    expect(["not_exported", "review_required"]).toContain(report.candidates[0].export_status);
    expect(existsSync(join(r, "skills", "Workflow procedure candidate", "SKILL.md"))).toBe(false);
    rmSync(r, { recursive: true, force: true });
  });
});
