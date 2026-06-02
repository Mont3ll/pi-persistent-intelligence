import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord } from "../../src/store";
import { appendEvidenceRecord } from "../../src/evidence";
import { runMemoryDiagnostics, renderDiagnosticsReport } from "../../src/diagnostics";
import type { MemoryRecord } from "../../src/types";

function root(): string { const r = mkdtempSync(join(tmpdir(), "pi-diag-a-")); ensureMemoryDirs(r); return r; }
function rec(id: string, statement: string, ref = "ev1"): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["test"], statement, evidence: [{ type: "manual", ref, note: "support" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-05-01", updated_at: "2026-05-01", review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If contradicted." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null }; }

describe("Pass A diagnostics", () => {
  test("reports and redacts secret-like content", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem1", "token ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD"));
    const report = runMemoryDiagnostics(r);
    const text = renderDiagnosticsReport(report);
    expect(report.findings.some((f) => f.code === "secret_like_content_detected")).toBe(true);
    expect(text).toContain("secret_like_content_detected");
    expect(text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD");
    rmSync(r, { recursive: true, force: true });
  });

  test("includes provenance liveness and reverification findings", () => {
    const r = root();
    appendEvidenceRecord(r, { id: "ev1", resource_id: "r", profile_id: "p", created_at: "2026-05-01", source_kind: "conversation", source_summary: "gone", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem1"], redaction_status: "deleted" });
    unsafeAddMemoryRecord(r, rec("mem1", "Use bun.", "ev1"));
    const report = runMemoryDiagnostics(r);
    expect(report.findings.some((f) => f.code === "evidence_redacted_or_deleted")).toBe(true);
    expect(report.findings.some((f) => f.code === "reverification_recommended")).toBe(true);
    rmSync(r, { recursive: true, force: true });
  });
});
