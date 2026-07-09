import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvidenceRecord } from "../../src/evidence";
import { simulatePatchImpact, renderGovernanceSimulationReport } from "../../src/governance-simulation";
import { ensureMemoryDirs } from "../../src/paths";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryPatch, MemoryRecord } from "../../src/types";

function root(): string {
  const r = mkdtempSync(join(tmpdir(), "pi-gov-sim-"));
  ensureMemoryDirs(r);
  return r;
}

function rec(id: string, statement = `Memory ${id}`): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["simulation"],
    statement,
    evidence: [{ type: "manual", ref: "ev_live", note: "support" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    review: { cadence_days: 30, next_review: "2026-08-01", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
  };
}

describe("governance simulation", () => {
  test("previews patch quality impact without applying durable mutation", () => {
    const r = root();
    appendEvidenceRecord(r, { id: "ev_live", resource_id: "res", profile_id: "default", created_at: "2026-07-01T00:00:00Z", source_kind: "conversation", source_summary: "live", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_old", "mem_new"], redaction_status: "none" });
    unsafeAddMemoryRecord(r, rec("mem_old", "Old workflow guidance."));
    const patch: MemoryPatch = {
      patch_id: "patch_sim",
      created_at: "2026-07-09T00:00:00Z",
      generated_by: "manual",
      mode: "propose",
      summary: "Supersede old guidance",
      status: "proposed",
      applied_at: null,
      applied_ops: [],
      skipped_ops: [],
      ops: [{ op_id: "op_supersede", op: "supersede", target_id: "mem_old", to_record: rec("mem_new", "New workflow guidance."), risk: "low", default_selected: true }],
    };
    const before = JSON.stringify(loadAllRecords(r));

    const report = simulatePatchImpact(r, patch, { now: "2026-07-09T00:00:00Z" });

    expect(report.patch_id).toBe("patch_sim");
    expect(report.applied_op_ids).toEqual(["op_supersede"]);
    expect(report.before.store_quality).toBeGreaterThan(0);
    expect(report.after.store_quality).toBeGreaterThan(0);
    expect(report.deltas.memory_count_delta).toBe(1);
    expect(report.affected_memory_ids).toEqual(expect.arrayContaining(["mem_old", "mem_new"]));
    expect(report.review_required).toBe(true);
    expect(report.mutation_performed).toBe(false);
    expect(JSON.stringify(loadAllRecords(r))).toBe(before);
    expect(renderGovernanceSimulationReport(report)).toContain("No automatic mutation performed");
    rmSync(r, { recursive: true, force: true });
  });
});
