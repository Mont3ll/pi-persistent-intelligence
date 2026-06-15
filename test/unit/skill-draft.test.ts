import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvidenceRecord } from "../../src/evidence";
import { draftSkillFromProcedureCandidate } from "../../src/skill-draft";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-skill-draft-")); ensureMemoryDirs(dir); return dir; }
function cleanup(dir: string): void { rmSync(dir, { recursive: true, force: true }); }
function rec(id: string, evidenceId: string): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["workflow", "testing"], statement: "Always run bun test and bun run typecheck before commit.", evidence: [{ type: "manual", ref: evidenceId, note: "n" }], confidence: 0.9, stability: "stable", created_at: "2026-06-15", updated_at: "2026-06-15", review: { cadence_days: 30, next_review: "2026-07-15", change_condition: "if changed" }, status: "active", supersedes: [], superseded_by: [], vault_ref: null, ruleType: "workflow" }; }

describe("review-gated skill draft export", () => {
  test("valid procedure source generates draft artifact without writing skills", () => {
    const dir = root();
    try {
      const evidence = appendEvidenceRecord(dir, { id: "ev", resource_id: "r", profile_id: "default", created_at: "n", source_kind: "conversation", source_summary: "run bun test", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["m1"] });
      unsafeAddMemoryRecord(dir, rec("m1", evidence.id));
      unsafeAddMemoryRecord(dir, { ...rec("m2", evidence.id), statement: "Run typecheck before pushing." });
      const result = draftSkillFromProcedureCandidate(dir, "", "2026-06-15T00:00:00Z");
      expect(result.status).toBe("draft_created");
      expect(result.artifact?.export_status).toBe("review_required");
      expect(result.artifact?.content).toContain("## Failure modes and guards");
      expect(result.artifact?.content).toContain("## Self-check before completion");
      expect(existsSync(join(dir, "skills"))).toBe(false);
    } finally { cleanup(dir); }
  });

  test("missing procedure candidate fails safely", () => {
    const dir = root();
    try { expect(draftSkillFromProcedureCandidate(dir, "missing").status).toBe("failed"); } finally { cleanup(dir); }
  });
});
