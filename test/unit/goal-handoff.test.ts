import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord, loadAllRecords } from "../../src/store";
import { createInquiryRecord, appendInquiryRecord } from "../../src/inquiries";
import { generateGoalHandoffSnapshot } from "../../src/meta-consolidation";
import type { MemoryRecord } from "../../src/types";

function root(): string { const r = mkdtempSync(join(tmpdir(), "pi-goal-")); ensureMemoryDirs(r); return r; }
function rec(id: string, statement = "Use bun."): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["test"], statement, evidence: [{ type: "manual", ref: "ev1", note: "support" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-05-01", updated_at: "2026-05-01", review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If contradicted." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null }; }

describe("goal handoff", () => {
  test("includes goal context and does not mutate memory", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem1"));
    appendInquiryRecord(r, createInquiryRecord({ question: "Clarify scope?", context: "ctx", now: "2026-05-01T00:00:00Z" }));
    const before = loadAllRecords(r).length;
    const snapshot = generateGoalHandoffSnapshot(r, { declared_goal: "Ship safely", constraints: ["No publish"], validation_steps: ["bun test"], now: "2026-05-02T00:00:00Z" });
    expect(snapshot.declared_goal).toBe("Ship safely");
    expect(snapshot.active_memory_ids).toContain("mem1");
    expect(snapshot.open_inquiry_ids.length).toBe(1);
    expect(snapshot.background_reference_warning).toContain("background reference");
    expect(loadAllRecords(r)).toHaveLength(before);
    rmSync(r, { recursive: true, force: true });
  });

  test("redacts secrets in goal fields", () => {
    const r = root();
    const snapshot = generateGoalHandoffSnapshot(r, { declared_goal: "Use ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD", now: "2026-05-02T00:00:00Z" });
    expect(JSON.stringify(snapshot)).toContain("[redacted_secret:github_token]");
    expect(JSON.stringify(snapshot)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD");
    rmSync(r, { recursive: true, force: true });
  });
});
