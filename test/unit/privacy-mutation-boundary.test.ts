import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../../src/config";
import { createInquiryRecord, appendInquiryRecord, readInquiryRecords } from "../../src/inquiries";
import { generateHandoffSnapshot } from "../../src/meta-consolidation";
import { applyPatch } from "../../src/patch";
import { appendRecallEvent, readRecallEvents } from "../../src/recall-events";
import { appendReinforcementEvent, createReinforcementEvent, readReinforcementEvents } from "../../src/reinforcement";
import { appendRuntimeEvent, readRecentRuntimeEvents } from "../../src/runtime-events";
import { unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryPatch, MemoryRecord } from "../../src/types";

let roots: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-h5-boundary-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  roots = [];
});

function record(id: string, statement: string): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["privacy"],
    statement,
    evidence: [{ type: "manual", ref: "ev_private", note: "private support" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-09-01",
    updated_at: "2026-09-01",
    review: { cadence_days: 30, next_review: "2026-10-01", change_condition: "If revoked." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
  };
}

function privacyDelete(id: string): MemoryPatch {
  return {
    patch_id: "patch_privacy_boundary",
    created_at: "2026-09-27T08:00:00Z",
    generated_by: "manual",
    mode: "supervised",
    summary: "privacy boundary test",
    ops: [{
      op_id: "op_privacy_delete",
      op: "delete",
      target_id: id,
      risk: "high",
      default_selected: true,
      deletion_mode: "privacy_purge",
      deletion_reason: "user_requested",
    }],
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}

function handoffText(dir: string): string {
  const reportDir = join(dir, "reports", "handoff");
  try {
    return readdirSync(reportDir)
      .map((name) => readFileSync(join(reportDir, name), "utf8"))
      .join("\n");
  } catch {
    return "";
  }
}

describe("H5 privacy and mutation boundary", () => {
  test("privacy defaults minimize prompt excerpts and define bounded diagnostic retention", () => {
    const privacy = (defaultConfig as unknown as {
      privacy?: { persistPromptExcerpts?: boolean; diagnosticRetentionDays?: number };
    }).privacy;

    expect(privacy?.persistPromptExcerpts).toBe(false);
    expect(Number.isInteger(privacy?.diagnosticRetentionDays)).toBe(true);
    expect(privacy?.diagnosticRetentionDays).toBeGreaterThan(0);
  });

  test("recall telemetry does not persist raw prompt text by default", () => {
    const dir = root();
    appendRecallEvent(dir, {
      id: "recall_private",
      timestamp: "2026-09-27T08:00:00Z",
      query_hash: "hash_private",
      prompt_excerpt: "private customer diagnosis and account details",
      selected_memory_ids: [],
      excluded_memory_ids: [],
      source: "retrieval",
      mutation_performed: false,
    });

    expect(readRecallEvents(dir)[0]?.prompt_excerpt).toBe("");
  });

  test("diagnostic retention removes expired recall and runtime text", () => {
    const dir = root();
    appendRecallEvent(dir, {
      id: "recall_old",
      timestamp: "2026-01-01T00:00:00Z",
      query_hash: "old",
      prompt_excerpt: "expired private prompt",
      selected_memory_ids: [],
      excluded_memory_ids: [],
      source: "retrieval",
      mutation_performed: false,
    });
    appendRuntimeEvent(dir, {
      type: "warn",
      severity: "medium",
      component: "privacy-test",
      message: "expired private diagnostic",
      timestamp: "2026-01-01T00:00:00Z",
    });

    appendRecallEvent(dir, {
      id: "recall_current",
      timestamp: "2026-09-27T08:00:00Z",
      query_hash: "current",
      prompt_excerpt: "current prompt",
      selected_memory_ids: [],
      excluded_memory_ids: [],
      source: "retrieval",
      mutation_performed: false,
    });
    appendRuntimeEvent(dir, {
      type: "warn",
      severity: "medium",
      component: "privacy-test",
      message: "current diagnostic",
      timestamp: "2026-09-27T08:00:00Z",
    });

    expect(readRecallEvents(dir).map((event) => event.id)).toEqual(["recall_current"]);
    expect(readRecentRuntimeEvents(dir, { hours: 24 * 365, minSeverity: "low", now: "2026-09-27T08:00:00Z" }).map((event) => event.message))
      .toEqual(["current diagnostic"]);
  });

  test("privacy purge removes correlated content from derivative stores and reports", () => {
    const dir = root();
    const memoryId = "mem_private_boundary";
    const secret = "sensitive reproductive health note 4927";
    const privateRecord = record(memoryId, secret);
    unsafeAddMemoryRecord(dir, privateRecord);

    appendRecallEvent(dir, {
      id: "recall_derivative",
      timestamp: "2026-09-27T08:00:00Z",
      query_hash: "hash_derivative",
      prompt_excerpt: secret,
      selected_memory_ids: [memoryId],
      excluded_memory_ids: [],
      source: "retrieval",
      mutation_performed: false,
    });
    appendReinforcementEvent(dir, createReinforcementEvent({
      memory_id: memoryId,
      outcome: "explicit_reinforcement",
      notes: secret,
      now: "2026-09-27T08:00:00Z",
    }));
    appendInquiryRecord(dir, createInquiryRecord({
      question: `Should ${secret} remain?`,
      context: `Related to ${memoryId}: ${secret}`,
      related_memory_ids: [memoryId],
      now: "2026-09-27T08:00:00Z",
    }));
    appendRuntimeEvent(dir, {
      type: "warn",
      severity: "medium",
      component: "privacy-test",
      message: `${memoryId}: ${secret}`,
      timestamp: "2026-09-27T08:00:00Z",
    });
    generateHandoffSnapshot(dir, {
      selected_memory: [privateRecord],
      now: "2026-09-27T08:00:00Z",
    });

    applyPatch(dir, privacyDelete(memoryId), { now: "2026-09-27T08:01:00Z" });

    const derivativeText = [
      JSON.stringify(readRecallEvents(dir)),
      JSON.stringify(readReinforcementEvents(dir)),
      JSON.stringify(readInquiryRecords(dir)),
      JSON.stringify(readRecentRuntimeEvents(dir, { hours: 24, minSeverity: "low", now: "2026-09-27T08:01:00Z" })),
      handoffText(dir),
    ].join("\n");

    expect(derivativeText).not.toContain(secret);
    expect(derivativeText).not.toContain(memoryId);
  });

  test("published package prevents ordinary deep imports of unsafe canonical mutation helpers", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../..", "package.json"), "utf8")) as {
      exports?: Record<string, string>;
    };

    expect(pkg.exports?.["."]).toBe("./index.ts");
    expect(Object.keys(pkg.exports ?? {})).not.toContain("./src/*");
    expect(Object.keys(pkg.exports ?? {})).not.toContain("./src/store");
  });
});
