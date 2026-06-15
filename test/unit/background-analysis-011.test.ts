import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enqueueBackgroundAnalysis, runBackgroundAnalysisQueue } from "../../src/background-analysis";
import { appendCandidate } from "../../src/inbox";
import { ensureMemoryDirs } from "../../src/paths";
import { loadLayerRecords, unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-bg-011-")); ensureMemoryDirs(dir); return dir; }
function cleanup(dir: string): void { rmSync(dir, { recursive: true, force: true }); }
function rec(id: string): MemoryRecord { return { id, layer: "L2", profile_id: "default", scope: { type: "global" }, tags: ["workflow", "testing"], statement: "Always run bun test before commit.", evidence: [{ type: "manual", ref: "ev", note: "n" }], confidence: 0.9, stability: "stable", created_at: "2026-06-15", updated_at: "2026-06-15", review: { cadence_days: 30, next_review: "2026-07-15", change_condition: "if changed" }, status: "active", supersedes: [], superseded_by: [], vault_ref: null, ruleType: "workflow", normalized_key: "default|workflow" }; }

describe("0.11 background review-only runners", () => {
  test("meta-consolidation background job is report-only and does not mutate L1", () => {
    const dir = root();
    try {
      unsafeAddMemoryRecord(dir, rec("m1"));
      unsafeAddMemoryRecord(dir, { ...rec("m2"), statement: "Run typecheck before commit." });
      enqueueBackgroundAnalysis(dir, { kind: "meta_consolidation", profile_id: "default" }, "2026-06-15T00:00:00Z");
      const jobs = runBackgroundAnalysisQueue(dir);
      expect(jobs[0].status).toBe("succeeded");
      expect(jobs[0].warnings?.join(" ")).toContain("no L1 memory was mutated");
      expect(loadLayerRecords(dir, "L1")).toHaveLength(0);
      expect(jobs[0].output_artifact_path && existsSync(jobs[0].output_artifact_path)).toBe(true);
    } finally { cleanup(dir); }
  });

  test("vault-promotion background job is candidate artifact only and no vault mutation", () => {
    const dir = root();
    try {
      appendCandidate(dir, { id: "cap1", created_at: "n", source: { type: "manual", ref: "x" }, text: "Promote this to vault after review.", tags: ["documentation"], evidence_refs: ["x"], confidence: 0.7, status: "new" });
      enqueueBackgroundAnalysis(dir, { kind: "vault_promotion_candidates" }, "2026-06-15T00:00:00Z");
      const jobs = runBackgroundAnalysisQueue(dir);
      expect(jobs[0].status).toBe("succeeded");
      expect(jobs[0].warnings?.join(" ")).toContain("no vault files were mutated");
      expect(jobs[0].output_artifact_path && existsSync(jobs[0].output_artifact_path)).toBe(true);
    } finally { cleanup(dir); }
  });
});
