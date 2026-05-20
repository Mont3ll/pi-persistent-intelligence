import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord } from "../../src/store";
import { applyPatch } from "../../src/patch";
import { createReinforcementEvent } from "../../src/reinforcement";
import { generateMaintenanceRecommendations, buildStabilityPatchFromRecommendations, generateMaintenanceReport } from "../../src/maintenance";
import type { MemoryRecord, ReinforcementSummary } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-maint-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function record(id: string, stability: MemoryRecord["stability"] = "semi-stable"): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["testing"],
    statement: `${id} — use canonical JSONL for memory.`,
    evidence: [{ type: "manual", ref: "x", note: "n" }],
    confidence: 0.9,
    stability,
    created_at: "2026-05-19",
    updated_at: "2026-05-19",
    review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "workflow",
  };
}

function summary(memory_id: string, overrides: Partial<ReinforcementSummary> = {}): ReinforcementSummary {
  return {
    memory_id,
    counts: { explicit_reinforcement: 0, implicit_success: 0, neutral_exposure: 0, explicit_correction: 0 },
    score: 0,
    suggested_stability: "semi-stable",
    review_recommended: false,
    reasons: [],
    ...overrides,
  };
}

describe("maintenance recommendations", () => {
  test("explicit correction creates review_memory and decrease_stability recommendations", () => {
    const recs = generateMaintenanceRecommendations([record("mem_1")], [
      summary("mem_1", { counts: { explicit_correction: 1, implicit_success: 0, neutral_exposure: 0, explicit_reinforcement: 0 }, score: -1, suggested_stability: "low", review_recommended: true, reasons: ["correction"] }),
    ]);

    expect(recs.map((r) => r.kind)).toEqual(expect.arrayContaining(["review_memory", "decrease_stability"]));
    const corrRec = recs.find((r) => r.memory_id === "mem_1" && r.kind === "decrease_stability");
    expect(corrRec?.requires_review).toBe(true);
  });

  test("neutral exposure alone does not create stability increase", () => {
    const recs = generateMaintenanceRecommendations([record("mem_neutral")], [
      summary("mem_neutral", { counts: { neutral_exposure: 10, explicit_reinforcement: 0, implicit_success: 0, explicit_correction: 0 }, score: 0, suggested_stability: "semi-stable", review_recommended: false, reasons: [] }),
    ]);
    expect(recs.filter((r) => r.kind === "increase_stability")).toHaveLength(0);
  });

  test("implicit success alone cannot promote to stable", () => {
    const recs = generateMaintenanceRecommendations([record("mem_implicit")], [
      summary("mem_implicit", { counts: { implicit_success: 5, neutral_exposure: 0, explicit_reinforcement: 0, explicit_correction: 0 }, score: 1, suggested_stability: "semi-stable", review_recommended: false, reasons: [] }),
    ]);
    const increase = recs.find((r) => r.memory_id === "mem_implicit" && r.kind === "increase_stability");
    expect(increase?.suggested_stability).not.toBe("stable");
  });

  test("explicit reinforcement >= 2 with no corrections creates increase_stability recommendation", () => {
    const recs = generateMaintenanceRecommendations([record("mem_reinf")], [
      summary("mem_reinf", { counts: { explicit_reinforcement: 2, neutral_exposure: 0, implicit_success: 0, explicit_correction: 0 }, score: 2, suggested_stability: "stable", review_recommended: false, reasons: [] }),
    ]);
    const increase = recs.find((r) => r.kind === "increase_stability" && r.memory_id === "mem_reinf");
    expect(increase?.suggested_stability).toBe("stable");
    expect(increase?.requires_review).toBe(false);
  });

  test("recommendations do not mutate durable memory without patch application", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record("mem_no_mut", "semi-stable"));
    const recs = generateMaintenanceRecommendations([record("mem_no_mut", "semi-stable")], [
      summary("mem_no_mut", { counts: { explicit_correction: 1, implicit_success: 0, neutral_exposure: 0, explicit_reinforcement: 0 }, score: -1, suggested_stability: "low", review_recommended: true, reasons: [] }),
    ]);
    expect(recs.length).toBeGreaterThan(0);
    const { loadAllRecords } = require("../../src/store");
    const records = loadAllRecords(dir);
    expect(records.find((r: MemoryRecord) => r.id === "mem_no_mut")?.stability).toBe("semi-stable");
  });

  test("buildStabilityPatchFromRecommendations creates patch-governed update ops", () => {
    const recs = generateMaintenanceRecommendations([record("mem_patch")], [
      summary("mem_patch", { counts: { explicit_reinforcement: 2, implicit_success: 0, neutral_exposure: 0, explicit_correction: 0 }, score: 2, suggested_stability: "stable", review_recommended: false, reasons: [] }),
    ]);

    const patch = buildStabilityPatchFromRecommendations(recs, new Date().toISOString());
    expect(patch.ops.length).toBeGreaterThan(0);
    const op = patch.ops.find((o) => o.target_id === "mem_patch" && o.op === "update_stability");
    expect(op).not.toBeUndefined();
    expect(op?.updates?.stability).toBe("stable");
    expect(op?.risk).not.toBe("high");
  });

  test("decrease_stability patch op is review-required and low-confidence", () => {
    const recs = generateMaintenanceRecommendations([record("mem_dec")], [
      summary("mem_dec", { counts: { explicit_correction: 1, implicit_success: 0, neutral_exposure: 0, explicit_reinforcement: 0 }, score: -1, suggested_stability: "low", review_recommended: true, reasons: [] }),
    ]);

    const patch = buildStabilityPatchFromRecommendations(recs, new Date().toISOString());
    const op = patch.ops.find((o) => o.target_id === "mem_dec");
    expect(op?.risk).toBe("medium");
    expect(op?.default_selected).toBe(false);
  });

  test("generates readable maintenance report", () => {
    const recs = generateMaintenanceRecommendations(
      [record("mem_r1"), record("mem_r2", "stable")],
      [
        summary("mem_r1", { counts: { explicit_correction: 1, implicit_success: 0, neutral_exposure: 0, explicit_reinforcement: 0 }, score: -1, suggested_stability: "low", review_recommended: true, reasons: ["correction"] }),
        summary("mem_r2", { counts: { explicit_reinforcement: 2, implicit_success: 0, neutral_exposure: 0, explicit_correction: 0 }, score: 2, suggested_stability: "stable", review_recommended: false, reasons: [] }),
      ],
    );
    const report = generateMaintenanceReport(recs, [record("mem_r1"), record("mem_r2", "stable")]);
    expect(report).toContain("mem_r1");
    expect(report).toContain("decrease_stability");
    expect(report).toContain("review_memory");
    expect(report).toContain("mem_r2");
    expect(report).toContain("increase_stability");
  });
});
