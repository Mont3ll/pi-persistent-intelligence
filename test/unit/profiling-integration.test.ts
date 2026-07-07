import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMemoryDiagnostics } from "../../src/diagnostics";
import { ensureMemoryDirs } from "../../src/paths";
import { InvocationProfiler } from "../../src/profiling";
import { buildRecallXray } from "../../src/recall-xray";
import { unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

function root(): string {
  const r = mkdtempSync(join(tmpdir(), "pi-profile-integration-"));
  ensureMemoryDirs(r);
  return r;
}

function record(id: string): MemoryRecord {
  return { id, layer: "L2", scope: { type: "global" }, tags: ["profiling"], statement: "Use profiling spans for recall diagnostics.", evidence: [{ type: "manual", ref: "ev_profile", note: "support" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-07-07", updated_at: "2026-07-07", review: { cadence_days: 30, next_review: "2026-08-07", change_condition: "If profiler changes." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null };
}

describe("profiling integrations", () => {
  test("Recall X-ray reports stage timings when profiler is supplied", () => {
    const r = root();
    unsafeAddMemoryRecord(r, record("mem_profile"));
    const profiler = new InvocationProfiler("recall_xray");

    const report = buildRecallXray(r, { query: "profiling recall", profiler });

    expect(report.profile?.name).toBe("recall_xray");
    expect(report.profile?.spans.map((span) => span.name)).toEqual(expect.arrayContaining(["candidate_retrieval", "evidence_lookup", "policy_pipeline", "explanation_generation", "budget_summary"]));
    rmSync(r, { recursive: true, force: true });
  });

  test("Memory Doctor reports stage timings when profiling is enabled", () => {
    const r = root();
    unsafeAddMemoryRecord(r, record("mem_doctor_profile"));

    const report = runMemoryDiagnostics(r, { profile: true });

    expect(report.profile?.name).toBe("memory_diagnostics");
    expect(report.profile?.spans.map((span) => span.name)).toEqual(expect.arrayContaining(["store_existence", "record_evidence_load", "orphan_evidence", "privacy_scan", "provenance_liveness"]));
    rmSync(r, { recursive: true, force: true });
  });
});
