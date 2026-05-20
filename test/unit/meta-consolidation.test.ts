import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord } from "../../src/store";
import { appendEvidenceRecord } from "../../src/evidence";
import { appendDeletionTombstone, createDeletionTombstone } from "../../src/tombstones";
import { appendInquiryRecord, createInquiryRecord } from "../../src/inquiries";
import {
  clusterL2Records,
  searchCounterexamples,
  runMetaConsolidation,
  generateHandoffSnapshot,
} from "../../src/meta-consolidation";
import type { MemoryRecord, EvidenceRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-meta-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function record(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    profile_id: "project:test",
    layer: "L2",
    scope: { type: "global" },
    tags: ["workflow", "memory"],
    statement: `${id} — use canonical JSONL for memory governance.`,
    evidence: [{ type: "manual", ref: "ev_1", note: "n" }],
    confidence: 0.9,
    stability: "stable",
    created_at: "2026-05-19",
    updated_at: "2026-05-19",
    review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "workflow",
    normalized_key: "project-test|global|global|memory|workflow",
    ...overrides,
  };
}

function evidence(id: string, memoryId: string, overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id,
    resource_id: "user:test",
    profile_id: "project:test",
    created_at: "2026-05-19T10:00:00.000Z",
    source_kind: "conversation",
    source_ref: "message",
    source_summary: "Confirmed workflow pattern.",
    trust_class: "direct_user_instruction",
    polarity: "supports",
    related_memory_ids: [memoryId],
    ...overrides,
  };
}

describe("meta-consolidation", () => {
  test("clusters stable active L2 records by profile/topic/ruleType", () => {
    const records = [
      record("mem_a"),
      record("mem_b", { normalized_key: "project-test|global|global|memory|workflow" }),
      record("mem_c", { profile_id: "project:other", normalized_key: "project-other|global|global|memory|workflow" }),
    ];
    const clusters = clusterL2Records(records, "project:test");
    expect(clusters).toHaveLength(1);
    expect(clusters[0].profile_id).toBe("project:test");
    expect(clusters[0].source_memory_ids).toHaveLength(2);
  });

  test("excludes contested, deprecated, superseded, deleted records from clusters", () => {
    const records = [
      record("mem_active"),
      record("mem_contested", { status: "contested" }),
      record("mem_deprecated", { status: "deprecated" }),
      record("mem_superseded", { status: "superseded" }),
      record("mem_deleted", { status: "deleted" }),
    ];
    const clusters = clusterL2Records(records, "project:test");
    const ids = clusters.flatMap((c) => c.source_memory_ids);
    expect(ids).toContain("mem_active");
    expect(ids).not.toContain("mem_contested");
    expect(ids).not.toContain("mem_deprecated");
    expect(ids).not.toContain("mem_superseded");
    expect(ids).not.toContain("mem_deleted");
  });

  test("profile isolation: never clusters across different profiles", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record("mem_a", { profile_id: "project:alpha" }));
    unsafeAddMemoryRecord(dir, record("mem_b", { profile_id: "project:beta" }));
    const clusters = clusterL2Records([
      record("mem_a", { profile_id: "project:alpha" }),
      record("mem_b", { profile_id: "project:beta" }),
    ], "project:alpha");
    expect(clusters.flatMap((c) => c.source_memory_ids)).not.toContain("mem_b");
  });

  test("counterexample search detects contradictions, contested, inquiries, tombstones", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record("mem_contested", { status: "contested" }));
    appendDeletionTombstone(dir, createDeletionTombstone({ deleted_record_id: "mem_del", deletion_mode: "privacy_purge", deletion_reason: "user_requested", now: "2026-05-19T10:00:00.000Z" }));
    appendInquiryRecord(dir, createInquiryRecord({ question: "Should memory governance use JSONL?", context: "c", tags: ["memory"], profile_id: "project:test", now: "2026-05-19T10:00:00.000Z" }));

    const cluster = {
      cluster_key: "project-test|global|global|memory|workflow",
      profile_id: "project:test",
      topic: "memory",
      ruleType: "workflow" as const,
      normalized_keys: ["project-test|global|global|memory|workflow"],
      source_memory_ids: ["mem_a", "mem_contested", "mem_del"],
      stability_scores: [0.9, 0.9],
      avg_confidence: 0.9,
      known_exceptions: [],
      does_not_apply_when: [],
    };
    const result = searchCounterexamples(dir, cluster, [record("mem_a"), record("mem_contested", { status: "contested" })]);
    expect(result.performed).toBe(true);
    expect(result.contested_record_ids).toContain("mem_contested");
    expect(result.tombstone_ids).toContain("mem_del");
    expect(result.open_inquiry_ids).toHaveLength(1);
  });

  test("excluded unsafe/redacted evidence is tracked as unresolved question", () => {
    const dir = root();
    appendEvidenceRecord(dir, evidence("ev_redacted", "mem_a", { redaction_status: "deleted", source_summary: "[deleted]" }));
    const cluster = {
      cluster_key: "k",
      profile_id: "project:test",
      topic: "memory",
      source_memory_ids: ["mem_a"],
      stability_scores: [0.9],
      avg_confidence: 0.9,
      known_exceptions: [],
      does_not_apply_when: [],
      normalized_keys: [],
    };
    const result = searchCounterexamples(dir, cluster, [record("mem_a")]);
    expect(result.unresolved_questions.some((q) => q.includes("redacted") || q.includes("deleted"))).toBe(true);
  });

  test("runMetaConsolidation generates review-required L1 candidates and report", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record("mem_a"));
    unsafeAddMemoryRecord(dir, record("mem_b"));
    appendEvidenceRecord(dir, evidence("ev_1", "mem_a"));
    appendEvidenceRecord(dir, evidence("ev_2", "mem_b", { related_memory_ids: ["mem_b"] }));

    const run = runMetaConsolidation(dir, {
      enabled: true,
      cadence: "manual",
      min_l2_records: 2,
      min_reinforcement_score: 0,
      max_candidates_per_run: 5,
      max_input_records: 50,
      require_counterexample_search: true,
    }, "project:test", new Date().toISOString());

    expect(run.clusters.length).toBeGreaterThanOrEqual(1);
    for (const candidate of run.candidates) {
      expect(candidate.proposed_layer).toBe("L1");
      expect(candidate.promotion_eligibility).toBe("l1_review_only");
      expect(candidate.counterexample_search.performed).toBe(true);
    }
    const reportDir = join(dir, "reports", "meta-consolidation");
    const reportFiles = require("node:fs").readdirSync(reportDir).filter((f: string) => f.endsWith(".json") && !f.includes("artifact"));
    expect(reportFiles).toHaveLength(1);
  });

  test("candidates do not auto-apply — no L1 records written to canonical store", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record("mem_a"));
    unsafeAddMemoryRecord(dir, record("mem_b"));
    runMetaConsolidation(dir, {
      enabled: true, cadence: "manual", min_l2_records: 2, min_reinforcement_score: 0,
      max_candidates_per_run: 10, max_input_records: 50, require_counterexample_search: true,
    }, "project:test", new Date().toISOString());
    const { loadLayerRecords } = require("../../src/store");
    const l1Records = loadLayerRecords(dir, "L1");
    expect(l1Records).toHaveLength(0);
  });

  test("exception fields are preserved in L1 candidates", () => {
    const dir = root();
    const recWithExceptions = record("mem_exc", { applies_when: ["local dev"], does_not_apply_when: ["publishing"], known_exceptions: ["CI uses npm"] });
    unsafeAddMemoryRecord(dir, recWithExceptions);
    unsafeAddMemoryRecord(dir, record("mem_b"));
    const run = runMetaConsolidation(dir, {
      enabled: true, cadence: "manual", min_l2_records: 2, min_reinforcement_score: 0,
      max_candidates_per_run: 10, max_input_records: 50, require_counterexample_search: true,
    }, "project:test", new Date().toISOString());
    const candidate = run.candidates[0];
    if (candidate) {
      expect(candidate.counterexample_search.known_exceptions).toContain("CI uses npm");
    }
  });

  test("generateHandoffSnapshot produces a structured current-state summary", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record("mem_active_1"));
    unsafeAddMemoryRecord(dir, record("mem_active_2"));
    appendInquiryRecord(dir, createInquiryRecord({ question: "Should JSONL be canonical?", context: "c", profile_id: "project:test", now: "2026-05-19T10:00:00.000Z" }));

    const snapshot = generateHandoffSnapshot(dir, {
      profile_id: "project:test",
      selected_memory: [record("mem_active_1")],
      now: "2026-05-19T10:00:00.000Z",
    });

    expect(snapshot.active_l2_count).toBeGreaterThanOrEqual(2);
    expect(snapshot.open_inquiry_count).toBeGreaterThanOrEqual(1);
    expect(snapshot.selected_memory_brief).toHaveLength(1);
    const reportDir = join(dir, "reports", "handoff");
    expect(existsSync(reportDir)).toBe(true);
  });
});
