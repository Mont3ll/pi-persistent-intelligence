import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifest } from "./external-benchmark-manifest.test";
import { fingerprintManifest } from "../../eval/external/core/fingerprint";
import { writeApproval, writeManifest } from "../../eval/external/core/manifest";
import { assertPublicExportable, renderPublicReport, verifyBenchmarkRun } from "../../eval/external/core/report";

function runFixture(overrides: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-benchmark-report-")); const contract = { ...manifest, preset: "contract" as const, cases: ["synthetic-1"], expected: { cases: 1, modelCalls: 0, estimatedCostUsd: 0 } }; const fingerprint = writeManifest(join(dir, "manifest.json"), contract); writeApproval(join(dir, "approval.json"), fingerprint, "2026-08-01T00:00:00Z");
  const states = ["planned", "running", "answered", "evaluated", "verified"].flatMap((stage) => contract.tracks.map((track) => JSON.stringify({ caseId: "synthetic-1", track, stage, attempt: 1, at: "2026-08-01T00:00:00Z" }))).join("\n") + "\n"; writeFileSync(join(dir, "state.jsonl"), states);
  writeFileSync(join(dir, "run.json"), JSON.stringify({ manifestFingerprint: fingerprint, status: "contract", models: contract.models.map((model) => model.id), officialMetrics: { production: { exactMatch: 0 }, diagnostic: { exactMatch: 1 } }, results: contract.tracks.map((track) => ({ caseId: "synthetic-1", track, diagnostic: track === "diagnostic", latencyMs: 1, contextChars: 20 })), ...overrides }));
  return dir;
}
describe("external benchmark reporting", () => {
  test("verifies complete separated runs", async () => { const report = await verifyBenchmarkRun(runFixture()); expect(report.verified).toBe(true); expect(report.publishable).toBe(false); expect(report.completedCases).toBe(2); });
  test("rejects incomplete state and fingerprint drift", async () => {
    const dir = runFixture({ manifestFingerprint: "a".repeat(64) }); const report = await verifyBenchmarkRun(dir); expect(report.verified).toBe(false); expect(report.findings.some((finding) => finding.code === "fingerprint_drift")).toBe(true);
  });
  test("rejects diagnostic results labelled as production or unexpected", async () => { const dir = runFixture({ results: [{ caseId: "synthetic-1", track: "production", diagnostic: true }, { caseId: "other", track: "diagnostic", diagnostic: true }] }); const report = await verifyBenchmarkRun(dir); expect(report.findings.some((finding) => finding.code === "track_mislabeled")).toBe(true); expect(report.findings.some((finding) => finding.code === "unexpected_case")).toBe(true); });
  test("redacts public report paths and secrets while retaining provenance", async () => {
    const dir = runFixture({ note: "https://user:pass@example.test /home/alice/private /var/tmp/run", authorization: "Bearer secret", request_id: "req_123", OPENAI_API_KEY: "sk_example_secret_value" }); const verification = await verifyBenchmarkRun(dir); const report = renderPublicReport(dir, verification); const text = JSON.stringify(report); expect(text).not.toContain("alice"); expect(text).not.toContain("Bearer secret"); expect(text).not.toContain("user:pass"); expect(text).not.toContain("req_123"); expect(text).not.toContain("sk_example"); expect(report.manifestFingerprint).toBe(fingerprintManifest({ ...manifest, preset: "contract", cases: ["synthetic-1"], expected: { cases: 1, modelCalls: 0, estimatedCostUsd: 0 } }));
    expect(report.officialMetrics?.production?.exactMatch).toBe(0); expect(report.officialMetrics?.diagnostic?.exactMatch).toBe(1); expect(() => assertPublicExportable(verification)).toThrow("not publishable");
  });
});
