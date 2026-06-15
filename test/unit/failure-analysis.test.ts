import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enqueueBackgroundAnalysis, runBackgroundAnalysisQueue } from "../../src/background-analysis";
import { appendCandidate, listCandidates } from "../../src/inbox";
import { readOpenInquiries } from "../../src/inquiries";
import { runFailureAnalysis } from "../../src/failure-analysis";
import { ensureMemoryDirs } from "../../src/paths";

function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-failure-analysis-")); ensureMemoryDirs(dir); return dir; }
function cleanup(dir: string): void { rmSync(dir, { recursive: true, force: true }); }

describe("failure analysis", () => {
  test("failed background job creates review-only inquiry and saved report", () => {
    const dir = root();
    try {
      enqueueBackgroundAnalysis(dir, { kind: "diagnostics" }, "2026-06-15T00:00:00Z");
      runBackgroundAnalysisQueue(dir, { supportedKinds: [] });
      const { report, path } = runFailureAnalysis(dir, { save: true, now: "2026-06-15T00:01:00Z" });
      expect(report.durable_memory_mutated).toBe(false);
      expect(report.items.length).toBeGreaterThan(0);
      expect(readOpenInquiries(dir).length).toBeGreaterThan(0);
      expect(path && existsSync(path)).toBe(true);
    } finally { cleanup(dir); }
  });

  test("rejected correction candidate creates review candidate and no durable memory", () => {
    const dir = root();
    try {
      appendCandidate(dir, { id: "cap_rejected", created_at: "n", source: { type: "manual", ref: "x" }, text: "Always prefer bun after failed npm test.", tags: ["testing"], evidence_refs: ["x"], confidence: 0.6, status: "rejected" });
      const before = listCandidates(dir).length;
      const { report } = runFailureAnalysis(dir, { now: "2026-06-15T00:00:00Z" });
      expect(report.items.some((item) => item.classification === "correction_candidate")).toBe(true);
      expect(listCandidates(dir).length).toBeGreaterThan(before);
    } finally { cleanup(dir); }
  });
});
