import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendEvidenceRecord, readEvidenceRecords } from "../../src/evidence";
import { appendCandidate, listCandidates } from "../../src/inbox";
import { curateInbox } from "../../src/curator";
import { unsafeAddMemoryRecord } from "../../src/store";
import { buildRecallXray, renderRecallXrayReport } from "../../src/recall-xray";
import type { MemoryRecord } from "../../src/types";

function root(): string { const r = mkdtempSync(join(tmpdir(), "pi-code-ev-")); ensureMemoryDirs(r); return r; }
function record(): MemoryRecord { return { id: "mem_code", layer: "L2", scope: { type: "global" }, tags: ["testing"], statement: "Vitest currently passes for the test suite.", evidence: [{ type: "test_result", ref: "ev_code", note: "supports" }], confidence: 0.8, stability: "low", created_at: "2026-06-01", updated_at: "2026-06-01", review: { cadence_days: 14, next_review: "2026-06-15", change_condition: "If tests fail." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null }; }

describe("codebase-analysis evidence", () => {
  test("serializes and deserializes codebase analysis evidence metadata", () => {
    const r = root();
    appendEvidenceRecord(r, { id: "ev_code", resource_id: "repo", profile_id: "project", created_at: "2026-06-01T00:00:00Z", source_kind: "codebase_analysis", source_summary: "bun test passed", trust_class: "passing_tool_or_test_outcome", polarity: "supports", related_memory_ids: [], codebase_analysis: { source_kind: "codebase_analysis", tool: "vitest", command: "bun test", exit_code: 0, analysis_kind: "test", confidence: 0.8, timestamp: "2026-06-01T00:00:00Z" } });
    const ev = readEvidenceRecords(r)[0];
    expect(ev.source_kind).toBe("codebase_analysis");
    expect(ev.codebase_analysis?.tool).toBe("vitest");
    rmSync(r, { recursive: true, force: true });
  });

  test("supports a candidate but does not bypass review governance", () => {
    const r = root();
    appendEvidenceRecord(r, { id: "ev_code", resource_id: "repo", profile_id: "project", created_at: "2026-06-01T00:00:00Z", source_kind: "codebase_analysis", source_summary: "tsc passed", trust_class: "passing_tool_or_test_outcome", polarity: "supports", related_memory_ids: [], codebase_analysis: { source_kind: "codebase_analysis", tool: "tsc", command: "bun run typecheck", exit_code: 0, analysis_kind: "typecheck", confidence: 0.8, timestamp: "2026-06-01T00:00:00Z" } });
    appendCandidate(r, { id: "cap_code", created_at: "2026-06-01T00:00:00Z", source: { type: "codebase_analysis", ref: "ev_code" }, text: "Typecheck currently passes.", tags: ["testing"], evidence_refs: ["ev_code"], evidence_ids: ["ev_code"], confidence: 0.8, status: "new", primary_trust_class: "passing_tool_or_test_outcome", promotion_eligibility: "review_only", poisoning_risk: "low" });
    const patch = curateInbox(r, { now: "2026-06-01T00:01:00Z", mode: "propose" });
    expect(listCandidates(r)).toHaveLength(1);
    expect(patch.ops.some((op) => op.default_selected)).toBe(false);
    rmSync(r, { recursive: true, force: true });
  });

  test("recall x-ray displays codebase evidence and redacts secrets", () => {
    const r = root();
    unsafeAddMemoryRecord(r, record());
    appendEvidenceRecord(r, { id: "ev_code", resource_id: "repo", profile_id: "project", created_at: "2026-06-01T00:00:00Z", source_kind: "codebase_analysis", source_summary: "eslint reported a lint result", trust_class: "passing_tool_or_test_outcome", polarity: "supports", related_memory_ids: ["mem_code"], codebase_analysis: { source_kind: "codebase_analysis", tool: "eslint", command: "bun lint", exit_code: 1, analysis_kind: "lint", confidence: 0.7, timestamp: "2026-06-01T00:00:00Z" } });
    const report = buildRecallXray(r, { query: "vitest test", profile_id: "project", resource_id: "repo" });
    expect(report.included[0].evidence_source_kinds).toContain("codebase_analysis");
    const rendered = renderRecallXrayReport(report);
    expect(rendered).toContain("codebase_analysis");
    expect(rendered).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD");
    rmSync(r, { recursive: true, force: true });
  });
});
