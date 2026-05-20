import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import {
  appendReinforcementEvent,
  createReinforcementEvent,
  linkExplicitCorrectionToMemory,
  readReinforcementEvents,
  readReinforcementEventsForMemory,
  summarizeReinforcement,
} from "../../src/reinforcement";
import type { MemoryRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-reinforce-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function record(id: string, statement: string, profile_id = "project:test"): MemoryRecord {
  return {
    id,
    profile_id,
    thread_id: "thread-1",
    layer: "L2",
    scope: { type: "global" },
    tags: ["testing"],
    statement,
    evidence: [{ type: "manual", ref: "x", note: "n" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-05-19",
    updated_at: "2026-05-19",
    review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
  };
}

describe("reinforcement records", () => {
  test("creates profile/thread-aware reinforcement events", () => {
    const event = createReinforcementEvent({
      resource_id: "user:test",
      profile_id: "project:test",
      thread_id: "thread-1",
      memory_id: "mem_1",
      outcome: "explicit_reinforcement",
      evidence_id: "ev_1",
      notes: "User confirmed this rule.",
      now: "2026-05-19T10:00:00.000Z",
    });

    expect(event.id).toContain("rein_mem_1_");
    expect(event.profile_id).toBe("project:test");
    expect(event.thread_id).toBe("thread-1");
    expect(event.outcome).toBe("explicit_reinforcement");
  });

  test("appends and reads reinforcement events", () => {
    const dir = root();
    const event = appendReinforcementEvent(dir, createReinforcementEvent({ memory_id: "mem_1", outcome: "neutral_exposure", now: "2026-05-19T10:00:00.000Z" }));

    expect(readReinforcementEvents(dir)).toHaveLength(1);
    expect(readReinforcementEventsForMemory(dir, "mem_1").map((item) => item.id)).toEqual([event.id]);
    expect(readReinforcementEventsForMemory(dir, "mem_2")).toEqual([]);
  });

  test("summary treats neutral exposure as no-op", () => {
    const summary = summarizeReinforcement([
      createReinforcementEvent({ memory_id: "mem_1", outcome: "neutral_exposure" }),
      createReinforcementEvent({ memory_id: "mem_1", outcome: "neutral_exposure" }),
    ]);

    expect(summary.counts.neutral_exposure).toBe(2);
    expect(summary.score).toBe(0);
    expect(summary.suggested_stability).toBe("semi-stable");
    expect(summary.review_recommended).toBe(false);
  });

  test("explicit correction recommends review and lower stability", () => {
    const summary = summarizeReinforcement([
      createReinforcementEvent({ memory_id: "mem_1", outcome: "implicit_success" }),
      createReinforcementEvent({ memory_id: "mem_1", outcome: "explicit_correction" }),
    ]);

    expect(summary.score).toBeLessThan(0);
    expect(summary.suggested_stability).toBe("low");
    expect(summary.review_recommended).toBe(true);
  });

  test("implicit success is weak and explicit reinforcement is strong", () => {
    const weak = summarizeReinforcement([
      createReinforcementEvent({ memory_id: "mem_1", outcome: "implicit_success" }),
      createReinforcementEvent({ memory_id: "mem_1", outcome: "implicit_success" }),
    ]);
    const strong = summarizeReinforcement([
      createReinforcementEvent({ memory_id: "mem_1", outcome: "explicit_reinforcement" }),
      createReinforcementEvent({ memory_id: "mem_1", outcome: "implicit_success" }),
    ]);

    expect(weak.score).toBe(0.4);
    expect(weak.suggested_stability).toBe("semi-stable");
    expect(strong.score).toBe(1.2);
    expect(strong.suggested_stability).toBe("stable");
  });

  test("links clear explicit correction to matching selected memory", () => {
    const dir = root();
    const records = [
      record("mem_bun", "Use bun for local tests."),
      record("mem_docs", "Public repos should contain user-facing docs only."),
    ];

    const linked = linkExplicitCorrectionToMemory(dir, "Do not use bun for local tests here.", records, {
      resource_id: "user:test",
      profile_id: "project:test",
      thread_id: "thread-1",
      now: "2026-05-19T10:00:00.000Z",
    });

    expect(linked?.memory_id).toBe("mem_bun");
    expect(linked?.outcome).toBe("explicit_correction");
    expect(readReinforcementEventsForMemory(dir, "mem_bun")).toHaveLength(1);
  });

  test("does not link ambiguous correction", () => {
    const dir = root();
    const records = [record("mem_a", "Use bun for tests."), record("mem_b", "Use bun for builds.")];
    const linked = linkExplicitCorrectionToMemory(dir, "Do not use bun here.", records, { now: "2026-05-19T10:00:00.000Z" });
    expect(linked).toBeNull();
    expect(readReinforcementEvents(dir)).toHaveLength(0);
  });
});
