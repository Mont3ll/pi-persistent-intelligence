import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvidenceId } from "../../src/evidence";
import { applyLegacyEvidenceMigration, planLegacyEvidenceMigration, scanLegacyEvidenceMigration } from "../../src/evidence-migration";
import { ensureMemoryDirs } from "../../src/paths";
import { readEvidenceRecords } from "../../src/evidence";
import { loadAllRecords } from "../../src/store";
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

  test("applies only a reviewed unchanged plan with backup, audit, and idempotency", () => {
    const dir = root();
    const paths = ensureMemoryDirs(dir);
    writeFileSync(join(dir, "daily", "2026-07-03.md"), "User confirmed a durable workflow.\n", "utf-8");
    writeFileSync(paths.memory.L2, `${JSON.stringify(record("mem_apply", ["daily/2026-07-03.md"]))}\n`, "utf-8");
    const beforeRecord = loadAllRecords(dir)[0];
    const beforeEvidence = readFileSync(paths.memory.evidence, "utf-8");

    const preview = scanLegacyEvidenceMigration(dir);
    expect(preview).toMatchObject({ dry_run: true, mutation_performed: false, evidence_to_create: 1 });
    expect(readFileSync(paths.memory.evidence, "utf-8")).toBe(beforeEvidence);

    const applied = applyLegacyEvidenceMigration(dir, preview.fingerprint, "2026-07-18T12:00:00.000Z");
    expect(applied).toMatchObject({ dry_run: false, mutation_performed: true, evidence_created: 1, records_updated: 1 });
    expect(existsSync(applied.backup_path!)).toBe(true);
    expect(existsSync(applied.report_path!)).toBe(true);
    expect(readFileSync(join(applied.backup_path!, "memory", "evidence.jsonl"), "utf-8")).toBe(beforeEvidence);
    const afterRecord = loadAllRecords(dir)[0];
    expect(afterRecord.confidence).toBe(beforeRecord.confidence);
    expect(afterRecord.evidence.map((item) => item.ref)).toContain("daily/2026-07-03.md");
    expect(afterRecord.evidence.map((item) => item.ref)).toContain(readEvidenceRecords(dir)[0].id);
    expect(scanLegacyEvidenceMigration(dir).evidence_to_create).toBe(0);
  });

  test("rejects drift and blocks secret-bearing sources", () => {
    const dir = root();
    const paths = ensureMemoryDirs(dir);
    const source = join(dir, "daily", "2026-07-04.md");
    writeFileSync(source, "Normal source.\n", "utf-8");
    writeFileSync(paths.memory.L2, `${JSON.stringify(record("mem_drift", ["daily/2026-07-04.md"]))}\n`, "utf-8");
    const preview = scanLegacyEvidenceMigration(dir);
    writeFileSync(source, "Changed source.\n", "utf-8");
    expect(() => applyLegacyEvidenceMigration(dir, preview.fingerprint)).toThrow("stale");
    expect(readEvidenceRecords(dir)).toEqual([]);

    writeFileSync(source, "API_KEY=abcdefghijklmnop123456\n", "utf-8");
    const blocked = scanLegacyEvidenceMigration(dir);
    expect(blocked).toMatchObject({ evidence_to_create: 0, blocked_secret_references: 1 });
  });
});
