import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendEvidenceRecord } from "../../src/evidence";
import { unsafeAddMemoryRecord } from "../../src/store";
import { generateReverificationRecommendations } from "../../src/reverification";
import type { MemoryRecord } from "../../src/types";

function root(): string { const r = mkdtempSync(join(tmpdir(), "pi-reverify-")); ensureMemoryDirs(r); return r; }
function rec(id: string, refs: string[]): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["test"], statement: "Use bun.", evidence: refs.map((ref) => ({ type: "manual", ref, note: "support" })), confidence: 0.9, stability: "semi-stable", created_at: "2026-05-01", updated_at: "2026-05-01", review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If contradicted." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null }; }

describe("reverification recommendations", () => {
  test("flags high priority when all evidence is invalidated", () => {
    const r = root();
    appendEvidenceRecord(r, { id: "ev1", resource_id: "r", profile_id: "p", created_at: "2026-05-01", source_kind: "conversation", source_summary: "gone", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem1"], redaction_status: "deleted" });
    unsafeAddMemoryRecord(r, rec("mem1", ["ev1"]));
    const recs = generateReverificationRecommendations(r);
    expect(recs).toHaveLength(1);
    expect(recs[0].priority).toBe("high");
    rmSync(r, { recursive: true, force: true });
  });

  test("flags medium priority with mixed valid and invalid evidence", () => {
    const r = root();
    appendEvidenceRecord(r, { id: "ev1", resource_id: "r", profile_id: "p", created_at: "2026-05-01", source_kind: "conversation", source_summary: "gone", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem1"], redaction_status: "redacted" });
    appendEvidenceRecord(r, { id: "ev2", resource_id: "r", profile_id: "p", created_at: "2026-05-01", source_kind: "conversation", source_summary: "ok", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem1"], redaction_status: "none" });
    unsafeAddMemoryRecord(r, rec("mem1", ["ev1", "ev2"]));
    const recs = generateReverificationRecommendations(r);
    expect(recs[0].priority).toBe("medium");
    rmSync(r, { recursive: true, force: true });
  });
});
