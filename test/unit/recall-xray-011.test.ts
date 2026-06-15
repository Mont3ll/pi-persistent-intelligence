import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { buildRecallXray, renderRecallXrayReport } from "../../src/recall-xray";
import { unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-xray-011-")); ensureMemoryDirs(dir); return dir; }
function cleanup(dir: string): void { rmSync(dir, { recursive: true, force: true }); }
function rec(id: string, statement: string, opts: Partial<MemoryRecord> = {}): MemoryRecord {
  return { id, layer: "L2", scope: { type: "global" }, tags: ["testing"], statement, evidence: [{ type: "manual", ref: "ev", note: "n" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-06-15", updated_at: "2026-06-15", review: { cadence_days: 30, next_review: "2026-07-15", change_condition: "if contradicted" }, status: "active", supersedes: [], superseded_by: [], vault_ref: null, ...opts };
}

describe("recall x-ray 0.11 diagnostics", () => {
  test("context budget explains selected and omitted records", () => {
    const dir = root();
    try {
      unsafeAddMemoryRecord(dir, rec("mem_bun", "Always run bun test before commit.", { ruleType: "testing" }));
      unsafeAddMemoryRecord(dir, rec("mem_npm", "Use npm test only in legacy frontend.", { does_not_apply_when: ["bun"] }));
      const report = buildRecallXray(dir, { query: "bun test", injection_mode: "policy_only" });
      expect(report.summary.context_budget.selected_count).toBe(report.included.length);
      expect(report.summary.context_budget.omitted_count).toBe(report.excluded.length);
      expect(report.summary.context_budget.estimated_tokens).toBeGreaterThan(0);
      expect(report.summary.context_budget.injection_mode).toBe("policy_only");
      expect(Object.values(report.summary.context_budget.omission_reasons).reduce((a, b) => a + b, 0)).toBe(report.excluded.length);
    } finally { cleanup(dir); }
  });

  test("score provenance reports FTS and no semantic score when unavailable", () => {
    const dir = root();
    try {
      unsafeAddMemoryRecord(dir, rec("mem_bun", "Always run bun test before commit."));
      const report = buildRecallXray(dir, { query: "bun test" });
      const item = report.included.find((entry) => entry.memory_id === "mem_bun")!;
      expect(item.score_provenance?.fts_score).toBeGreaterThan(0);
      expect(item.score_provenance?.semantic_provider).toBe("none");
      expect(item.score_provenance?.semantic_score).toBeUndefined();
      expect(renderRecallXrayReport(report)).toContain("Context budget");
    } finally { cleanup(dir); }
  });

  test("redaction applies to budget/rendered output", () => {
    const dir = root();
    try {
      unsafeAddMemoryRecord(dir, rec("mem_secret", "Always use token OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP carefully."));
      const rendered = renderRecallXrayReport(buildRecallXray(dir, { query: "token" }));
      expect(rendered).not.toContain("sk-proj-");
      expect(rendered).toContain("[redacted_secret");
    } finally { cleanup(dir); }
  });
});
