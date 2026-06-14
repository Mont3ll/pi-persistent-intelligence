import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { enqueueBackgroundAnalysis, listBackgroundAnalysisJobs, runBackgroundAnalysisQueue } from "../../src/background-analysis";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import { appendEvidenceRecord } from "../../src/evidence";
import type { MemoryRecord } from "../../src/types";

function rec(id: string, evidenceRef = "ev1"): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["testing"], statement: "Use bun test.", evidence: [{ type: "manual", ref: evidenceRef, note: "support" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-06-01", updated_at: "2026-06-01", review: { cadence_days: 30, next_review: "2026-07-01", change_condition: "If tooling changes." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null }; }

describe("background analysis queue", () => {
  test("creates jobs and records status transitions", () => {
    const r = mkdtempSync(join(tmpdir(), "pi-bg-")); ensureMemoryDirs(r);
    const job = enqueueBackgroundAnalysis(r, { kind: "diagnostics", input_summary: "test" }, "2026-06-01T00:00:00Z");
    expect(job.status).toBe("queued");
    const result = runBackgroundAnalysisQueue(r, { now: "2026-06-01T00:01:00Z" });
    expect(result[0].status).toBe("succeeded");
    expect(existsSync(result[0].output_artifact_path!)).toBe(true);
    expect(listBackgroundAnalysisJobs(r)[0].status).toBe("succeeded");
    rmSync(r, { recursive: true, force: true });
  });

  test("failed job records safe error", () => {
    const r = mkdtempSync(join(tmpdir(), "pi-bg-")); ensureMemoryDirs(r);
    enqueueBackgroundAnalysis(r, { kind: "memory_graph" as any, input_summary: "unsupported in first runner" }, "2026-06-01T00:00:00Z");
    const result = runBackgroundAnalysisQueue(r, { now: "2026-06-01T00:01:00Z", supportedKinds: ["diagnostics"] });
    expect(result[0].status).toBe("failed");
    expect(result[0].error).toContain("Unsupported background analysis kind");
    rmSync(r, { recursive: true, force: true });
  });

  test("runs provenance liveness, reverification, graph, timeline, procedure, and worth review report jobs", () => {
    const r = mkdtempSync(join(tmpdir(), "pi-bg-")); ensureMemoryDirs(r);
    const missing = join(r, "missing-source.md");
    unsafeAddMemoryRecord(r, rec("mem_bg", "ev_redacted"));
    unsafeAddMemoryRecord(r, rec("mem_proc_a", "ev_ok"));
    unsafeAddMemoryRecord(r, rec("mem_proc_b", "ev_ok"));
    appendEvidenceRecord(r, { id: "ev_redacted", resource_id: "r", profile_id: "p", created_at: "2026-06-01", source_kind: "file", source_file: missing, source_summary: "gone", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_bg"], redaction_status: "redacted" });
    appendEvidenceRecord(r, { id: "ev_ok", resource_id: "r", profile_id: "p", created_at: "2026-06-01", source_kind: "conversation", source_summary: "ok", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_proc_a", "mem_proc_b"], redaction_status: "none" });
    writeFileSync(join(r, "inbox", "captured.jsonl"), JSON.stringify({ id: "cap_worth", created_at: "2026-06-01", source: { type: "manual", ref: "daily" }, text: "ok thanks", tags: [], evidence_refs: ["daily"], status: "new" }) + "\n");
    for (const kind of ["provenance_liveness", "reverification", "memory_graph", "memory_timeline", "procedure_candidates", "memory_worth_review"] as const) enqueueBackgroundAnalysis(r, { kind }, `2026-06-01T00:00:0${kind.length % 10}Z`);
    const before = loadAllRecords(r).length;
    const result = runBackgroundAnalysisQueue(r, { now: "2026-06-01T00:01:00Z" });
    const completed = result.filter((job) => job.status === "succeeded");
    expect(completed).toHaveLength(6);
    for (const job of completed) {
      expect(job.output_artifact_path).toBeTruthy();
      expect(existsSync(job.output_artifact_path!)).toBe(true);
    }
    expect(loadAllRecords(r)).toHaveLength(before);
    rmSync(r, { recursive: true, force: true });
  });

  test("repeated run does not corrupt artifacts and does not mutate memory", () => {
    const r = mkdtempSync(join(tmpdir(), "pi-bg-")); ensureMemoryDirs(r);
    enqueueBackgroundAnalysis(r, { kind: "diagnostics" }, "2026-06-01T00:00:00Z");
    const before = loadAllRecords(r).length;
    runBackgroundAnalysisQueue(r, { now: "2026-06-01T00:01:00Z" });
    const afterFirst = listBackgroundAnalysisJobs(r)[0];
    runBackgroundAnalysisQueue(r, { now: "2026-06-01T00:02:00Z" });
    const afterSecond = listBackgroundAnalysisJobs(r)[0];
    expect(afterSecond.status).toBe("succeeded");
    expect(afterSecond.output_artifact_path).toBe(afterFirst.output_artifact_path);
    expect(readFileSync(afterSecond.output_artifact_path!, "utf-8")).toContain("PI Memory Diagnostics");
    expect(loadAllRecords(r).length).toBe(before);
    rmSync(r, { recursive: true, force: true });
  });
});
