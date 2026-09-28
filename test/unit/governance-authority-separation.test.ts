import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvidenceRecord } from "../../src/evidence";
import { buildRecallXray } from "../../src/recall-xray";
import { buildRetrievalContext, readLastInjectionStats } from "../../src/retriever";
import { extractHardRules } from "../../src/rules";
import { unsafeAddMemoryRecord } from "../../src/store";
import type { EvidenceRecord, GovernanceMode, MemoryRecord } from "../../src/types";

let roots: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-k5-authority-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  roots = [];
});

function record(id: string, confidence = 0.95): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["authority"],
    statement: `Directive candidate ${id}`,
    evidence: [{ type: "manual", ref: `ev_${id}`, note: "support" }],
    confidence,
    stability: "semi-stable",
    created_at: "2026-09-28",
    updated_at: "2026-09-28",
    review: { cadence_days: 30, next_review: "2026-10-28", change_condition: "If invalidated." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "correction",
  };
}

function ratifiedPolicy(base: MemoryRecord, evidenceRef = base.evidence[0].ref): MemoryRecord {
  return {
    ...base,
    authority_plane: "policy",
    policy_ratification: {
      method: "direct_user_instruction",
      evidence_refs: [evidenceRef],
      ratified_at: "2026-09-28T10:00:00Z",
    },
  } as MemoryRecord;
}

function evidenceFor(memory: MemoryRecord): EvidenceRecord {
  return {
    id: memory.evidence[0].ref,
    resource_id: "default",
    profile_id: "default",
    created_at: "2026-09-28T10:00:00Z",
    source_kind: "conversation",
    source_ref: "message",
    source_summary: "explicit source",
    trust_class: "direct_user_instruction",
    polarity: "supports",
    related_memory_ids: [memory.id],
  };
}

const extractWithMode = extractHardRules as unknown as (
  records: MemoryRecord[],
  mode?: GovernanceMode,
) => MemoryRecord[];

describe("K5 evidence, belief, and policy authority separation", () => {
  test("strict governance never promotes a high-confidence belief into a hard policy rule", () => {
    const belief = record("mem_belief", 1.0);

    expect(extractWithMode([belief], "strict")).toEqual([]);
  });

  test("strict governance admits explicitly ratified policy independent of confidence score", () => {
    const policy = ratifiedPolicy(record("mem_policy", 0.4));

    expect(extractWithMode([policy], "strict").map((item) => item.id)).toEqual(["mem_policy"]);
  });

  test("claimed policy without matching ratification provenance is not directive authority", () => {
    const policy = ratifiedPolicy(record("mem_unproven", 0.99), "ev_unrelated");

    expect(extractWithMode([policy], "strict")).toEqual([]);
  });

  test("compatibility mode preserves legacy high-confidence hard-rule behavior for migration", () => {
    const legacy = record("mem_legacy", 0.95);

    expect(extractWithMode([legacy], "compatibility").map((item) => item.id)).toEqual(["mem_legacy"]);
  });

  test("strict recall x-ray does not attribute an unratified belief as a hard rule", () => {
    const dir = root();
    const belief = record("mem_xray_belief", 0.99);
    unsafeAddMemoryRecord(dir, belief);
    appendEvidenceRecord(dir, evidenceFor(belief));

    const report = buildRecallXray(dir, {
      query: "Directive candidate mem_xray_belief",
      governance_mode: "strict",
      maxRecords: 10,
    });

    expect(report.summary.hard_rule_count).toBe(0);
    expect(report.included.find((item) => item.memory_id === belief.id)?.hard_rule).not.toBe(true);
  });

  test("strict recall x-ray attributes a ratified policy as directive authority even below legacy confidence threshold", () => {
    const dir = root();
    const policy = ratifiedPolicy(record("mem_xray_policy", 0.4));
    unsafeAddMemoryRecord(dir, policy);
    appendEvidenceRecord(dir, evidenceFor(policy));

    const report = buildRecallXray(dir, {
      query: "Directive candidate mem_xray_policy",
      governance_mode: "strict",
      maxRecords: 10,
    });

    expect(report.summary.hard_rule_count).toBe(1);
    expect(report.included.find((item) => item.memory_id === policy.id)?.hard_rule).toBe(true);
  });

  test("strict retrieval injection uses policy authority rather than compatibility confidence", async () => {
    const dir = root();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ governance: { mode: "strict" } }), "utf8");
    unsafeAddMemoryRecord(dir, record("mem_retrieval_belief", 1.0));

    await buildRetrievalContext(dir, {
      prompt: "How should this directive candidate be applied safely in this project?",
      today: "2026-09-28",
      useQmd: false,
    });

    expect(readLastInjectionStats(dir)?.hardRuleCount).toBe(0);
  });
});
