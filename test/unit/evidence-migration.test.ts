import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvidenceId } from "../../src/evidence";
import { planLegacyEvidenceMigration } from "../../src/evidence-migration";
import type { EvidenceRecord, MemoryRecord } from "../../src/types";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-evidence-migration-"));
  roots.push(dir);
  mkdirSync(join(dir, "daily"), { recursive: true });
  return dir;
}

function record(id: string, refs: string[]): MemoryRecord {
  return {
    id, resource_id: "resource-a", profile_id: "profile-a", layer: "L2", scope: { type: "global" }, tags: ["legacy"],
    statement: "Legacy record.", evidence: refs.map((ref) => ({ type: "manual", ref, note: "legacy" })),
    confidence: 0.72, stability: "low", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z",
    review: { cadence_days: 30, next_review: "2026-08-01", change_condition: "If evidence changes." },
    status: "active", supersedes: [], superseded_by: [], vault_ref: null,
  };
}

describe("legacy evidence migration planner", () => {
  test("plans deterministic structured evidence without fabricating missing references", () => {
    const dir = root();
    writeFileSync(join(dir, "daily", "2026-07-01.md"), "User confirmed the release workflow.\n", "utf-8");
    writeFileSync(join(dir, "daily", "2026-07-02.md"), "Task text mentions SECRET_TOKEN but contains no persisted credential.\n", "utf-8");
    const existingId = createEvidenceId({ profile_id: "profile-a", source_kind: "conversation", source_ref: "existing", source_summary: "existing" });
    const existing: EvidenceRecord = {
      id: existingId, resource_id: "resource-a", profile_id: "profile-a", created_at: "2026-07-01T00:00:00Z",
      source_kind: "conversation", source_ref: "existing", source_summary: "existing", trust_class: "agent_inference",
      polarity: "supports", durability_signal: "unknown", related_memory_ids: ["mem_existing"],
    };
    const records = [
      record("mem_daily", ["daily/2026-07-01.md"]),
      record("mem_existing", [existingId]),
      record("mem_multi", ["daily/2026-07-02.md", "daily/missing.md"]),
    ];

    const plan = planLegacyEvidenceMigration(dir, records, [existing]);

    expect(plan).toMatchObject({
      dry_run: true,
      mutation_performed: false,
      records_scanned: 3,
      references_scanned: 4,
      evidence_to_create: 2,
      existing_evidence_skipped: 1,
      unresolved_references: 1,
      blocked_secret_references: 0,
    });
    expect(plan.proposals.map((item) => item.evidence.source_ref).sort()).toEqual([
      "daily/2026-07-01.md",
      "daily/2026-07-02.md",
    ]);
    expect(plan.proposals.every((item) => item.evidence.notes === "legacy_evidence_backfill_v1")).toBe(true);
    expect(plan.proposals.every((item) => item.evidence.source_excerpt === undefined)).toBe(true);
    expect(plan.proposals.every((item) => item.evidence.trust_class === "unknown" && item.evidence.durability_signal === "unknown")).toBe(true);
  });
});
