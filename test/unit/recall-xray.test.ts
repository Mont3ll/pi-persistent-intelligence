import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord, loadAllRecords } from "../../src/store";
import { appendEvidenceRecord } from "../../src/evidence";
import { appendDeletionTombstone, createDeletionTombstone } from "../../src/tombstones";
import { buildRecallXray, renderRecallXrayReport } from "../../src/recall-xray";
import type { MemoryRecord } from "../../src/types";

function root(): string { const r = mkdtempSync(join(tmpdir(), "pi-xray-")); ensureMemoryDirs(r); return r; }
function rec(id: string, statement: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id, layer: "L2", scope: { type: "global" }, tags: ["testing"], statement,
    evidence: [{ type: "manual", ref: "ev1", note: "support" }], confidence: 0.9, stability: "semi-stable",
    created_at: "2026-06-01", updated_at: "2026-06-01", review: { cadence_days: 30, next_review: "2026-07-01", change_condition: "If contradicted." },
    status: "active", supersedes: [], superseded_by: [], vault_ref: null, ...overrides,
  };
}

describe("recall x-ray", () => {
  test("attributes active safe hard rules distinctly from ordinary memory", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem_hard", "Never use npm test in this project; use bun test.", { confidence: 0.95, ruleType: "avoid_pattern", memory_kind: "instruction" }));
    unsafeAddMemoryRecord(r, rec("mem_plain", "Use bun test for ordinary verification.", { confidence: 0.8, ruleType: "workflow" }));
    const report = buildRecallXray(r, { query: "bun test", profile_id: "prof", resource_id: "res" });
    const hard = report.included.find((item) => item.memory_id === "mem_hard")!;
    const plain = report.included.find((item) => item.memory_id === "mem_plain")!;
    expect(hard.retrieval_tier).toBe("hard_rule");
    expect(hard.hard_rule).toBe(true);
    expect(hard.rule_type).toBe("avoid_pattern");
    expect(hard.governance_safe).toBe(true);
    expect(hard.hard_rule_reason).toContain("active high-confidence");
    expect(plain.retrieval_tier).not.toBe("hard_rule");
    expect(report.summary.hard_rule_count).toBe(1);
    rmSync(r, { recursive: true, force: true });
  });

  test("contested, tombstoned, negative-scope, and strict-unsafe hard-rule candidates are not clean hard truth", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem_contested_hard", "Never use npm in contested cases.", { status: "contested", confidence: 0.95, ruleType: "avoid_pattern" }));
    unsafeAddMemoryRecord(r, rec("mem_tomb_hard", "Never use old deleted command.", { confidence: 0.95, ruleType: "avoid_pattern" }));
    unsafeAddMemoryRecord(r, rec("mem_negative_hard", "Never use npm except browser work.", { confidence: 0.95, ruleType: "avoid_pattern", does_not_apply_when: ["browser"] }));
    unsafeAddMemoryRecord(r, rec("mem_strict_unsafe", "Never use unsafe hard rule.", { confidence: 0.95, ruleType: "avoid_pattern", evidence: [{ type: "manual", ref: "legacy", note: "legacy" }] }));
    appendDeletionTombstone(r, createDeletionTombstone({ deleted_record_id: "mem_tomb_hard", deletion_mode: "privacy_purge", deletion_reason: "user_requested", now: "2026-06-01T00:00:00Z" }));
    const report = buildRecallXray(r, { query: "never npm browser unsafe", profile_id: "prof", resource_id: "res", governance_mode: "strict" });
    const byExcluded = Object.fromEntries(report.excluded.map((item) => [item.memory_id, item]));
    expect(byExcluded.mem_contested_hard.contested).toBe(true);
    expect(byExcluded.mem_tomb_hard.tombstoned).toBe(true);
    expect(byExcluded.mem_negative_hard.negative_scope_match).toBe(true);
    const unsafe = report.included.find((item) => item.memory_id === "mem_strict_unsafe")!;
    expect(unsafe.hard_rule).toBe(false);
    expect(unsafe.governance_safe).toBe(false);
    expect(unsafe.warnings?.join(" ")).toContain("strict governance");
    rmSync(r, { recursive: true, force: true });
  });

  test("explains included memory with evidence and trust fields", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem_bun", "Use bun test before committing.", { evidence: [{ type: "manual", ref: "ev_bun", note: "support" }], memory_kind: "instruction" }));
    appendEvidenceRecord(r, { id: "ev_bun", resource_id: "res", profile_id: "prof", created_at: "2026-06-01", source_kind: "conversation", source_summary: "User said use bun test.", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_bun"], redaction_status: "none" });
    const report = buildRecallXray(r, { query: "bun test", profile_id: "prof", resource_id: "res", working_directory: r });
    expect(report.summary.included_count).toBe(1);
    expect(report.included[0]).toMatchObject({ memory_id: "mem_bun", memory_kind: "instruction", trust_class: "direct_user_instruction", evidence_status: "present" });
    rmSync(r, { recursive: true, force: true });
  });

  test("explains exclusions for scope, negative scope, tombstone, contested and dependency invalidation", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem_project", "Use pnpm in other project.", { scope: { type: "project", project: "other" } }));
    unsafeAddMemoryRecord(r, rec("mem_negative", "Use bun except in browser tasks.", { does_not_apply_when: ["browser"] }));
    unsafeAddMemoryRecord(r, rec("mem_tomb", "Old deleted memory."));
    unsafeAddMemoryRecord(r, rec("mem_contested", "Contested bun rule.", { status: "contested" }));
    unsafeAddMemoryRecord(r, rec("mem_invalid", "Memory with invalid evidence.", { evidence: [{ type: "manual", ref: "ev_deleted", note: "support" }] }));
    appendDeletionTombstone(r, createDeletionTombstone({ deleted_record_id: "mem_tomb", deletion_mode: "privacy_purge", deletion_reason: "user_requested", now: "2026-06-01T00:00:00Z" }));
    appendEvidenceRecord(r, { id: "ev_deleted", resource_id: "res", profile_id: "prof", created_at: "2026-06-01", source_kind: "conversation", source_summary: "[deleted]", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_invalid"], redaction_status: "deleted" });
    const report = buildRecallXray(r, { query: "bun browser", profile_id: "prof", resource_id: "res", working_directory: "/repo/current", project_root: "/repo/current" });
    const byId = Object.fromEntries(report.excluded.map((e) => [e.memory_id, e]));
    expect(byId.mem_project.scope_mismatch).toBe(true);
    expect(byId.mem_negative.negative_scope_match).toBe(true);
    expect(byId.mem_tomb.tombstoned).toBe(true);
    expect(byId.mem_contested.contested).toBe(true);
    expect(byId.mem_invalid.dependency_invalidated).toBe(true);
    expect(loadAllRecords(r).length).toBe(5);
    rmSync(r, { recursive: true, force: true });
  });

  test("works for empty results", () => {
    const r = root();
    const report = buildRecallXray(r, { query: "nothing", profile_id: "prof", resource_id: "res" });
    expect(report.summary.included_count).toBe(0);
    expect(report.summary.excluded_count).toBe(0);
    rmSync(r, { recursive: true, force: true });
  });

  test("redacts secret-like content in rendered x-ray output", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem_secret", "Never store token ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD in docs."));
    const rendered = renderRecallXrayReport(buildRecallXray(r, { query: "token", profile_id: "prof", resource_id: "res" }));
    expect(rendered).toContain("[redacted_secret:github_token]");
    expect(rendered).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD");
    rmSync(r, { recursive: true, force: true });
  });
});
