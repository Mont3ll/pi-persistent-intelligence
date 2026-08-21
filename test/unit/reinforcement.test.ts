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
  recordExplicitReinforcement,
  decideReinforcementLink,
  classifyRecordedToolOutcome,
} from "../../src/reinforcement";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-reinforce-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function record(id: string, statement: string, profile_id = "project:test", overrides: Partial<MemoryRecord> = {}): MemoryRecord {
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
    ...overrides,
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

  test("explicit reinforcement requires active memory, bounds notes, deduplicates, and does not mutate records", () => {
    const dir = root();
    const memory = record("mem_explicit", "Use Bun for tests.");
    unsafeAddMemoryRecord(dir, memory);
    const before = JSON.stringify(loadAllRecords(dir));
    const note = "confirmed ".repeat(100);

    const first = recordExplicitReinforcement(dir, { memory_id: memory.id, note, session_id: "session-a", now: "2026-07-18T00:00:00Z" });
    const second = recordExplicitReinforcement(dir, { memory_id: memory.id, note, session_id: "session-a", now: "2026-07-18T00:01:00Z" });

    expect(first.created).toBe(true);
    expect(first.event.notes!.length).toBeLessThanOrEqual(300);
    expect(second.created).toBe(false);
    expect(readReinforcementEvents(dir)).toHaveLength(1);
    expect(JSON.stringify(loadAllRecords(dir))).toBe(before);
    expect(() => recordExplicitReinforcement(dir, { memory_id: "missing", note: "confirmed", session_id: "session-a" })).toThrow("active memory");
  });

  test("tool outcomes require explicit recorded success", () => {
    expect(classifyRecordedToolOutcome({})).toBe("unknown");
    expect(classifyRecordedToolOutcome({ isError: false })).toBe("unknown");
    expect(classifyRecordedToolOutcome({ exitCode: 0 })).toBe("success");
    expect(classifyRecordedToolOutcome({ code: 0 })).toBe("success");
    expect(classifyRecordedToolOutcome({ exitCode: 0, isError: true })).toBe("failure");
    expect(classifyRecordedToolOutcome({ success: true })).toBe("success");
    expect(classifyRecordedToolOutcome({ exit_code: 1 })).toBe("failure");
    expect(classifyRecordedToolOutcome({ status: "passed" })).toBe("success");
  });

  test("attributes recorded success to one uniquely relevant selected memory", () => {
    const selected = [record("mem_bun", "Use Bun for repository tests."), record("mem_docs", "Keep public documentation concise.")];
    const decision = decideReinforcementLink({ selected_memory: selected, session_id: "s", observable_outcome: { kind: "test", success: true, tool_name: "bash", command: "bun test test/unit/reinforcement.test.ts" }, neutral_exposure_enabled: false });

    expect(decision).toMatchObject({ outcome: "implicit_success", memory_id: "mem_bun", command_class: "test" });
    expect(decision.attribution_score).toBeGreaterThan(0);
    expect(decision.matched_signals).toContain("command_class");
  });

  test("uses command class to distinguish multiple selected memories", () => {
    const selected = [record("mem_test", "Run focused tests."), record("mem_typecheck", "Run TypeScript typecheck.")];
    expect(decideReinforcementLink({ selected_memory: selected, session_id: "s", observable_outcome: { kind: "test", success: true }, neutral_exposure_enabled: false })).toMatchObject({ outcome: "implicit_success", memory_id: "mem_test", command_class: "test" });
  });

  test("uses semantic operation terms to disambiguate class-aligned memories", () => {
    const selected = [record("mem_reinforcement", "Run reinforcement tests."), record("mem_capture", "Run capture tests.")];
    expect(decideReinforcementLink({ selected_memory: selected, session_id: "s", observable_outcome: { kind: "test", success: true, command: "bun test test/unit/reinforcement.test.ts" }, neutral_exposure_enabled: false })).toMatchObject({ outcome: "implicit_success", memory_id: "mem_reinforcement" });
  });

  test("uses explicit applicability but rejects ambiguous or irrelevant success", () => {
    const applicable = record("mem_applicable", "Follow the project verification convention.", "project:test", { applies_when: ["typecheck"] });
    expect(decideReinforcementLink({ selected_memory: [applicable, record("mem_docs", "Keep documentation concise.")], session_id: "s", observable_outcome: { kind: "tool", success: true, command: "bun run typecheck" }, neutral_exposure_enabled: false })).toMatchObject({ outcome: "implicit_success", memory_id: "mem_applicable", command_class: "typecheck" });

    const ambiguous = [record("mem_test_a", "Run project tests."), record("mem_test_b", "Use the project test suite.")];
    expect(decideReinforcementLink({ selected_memory: ambiguous, session_id: "s", observable_outcome: { kind: "test", success: true, command: "bun test" }, neutral_exposure_enabled: false })).toMatchObject({ outcome: "none", reason: "ambiguous_relevant_memories" });
    expect(decideReinforcementLink({ selected_memory: [record("mem_docs_only", "Keep documentation concise.")], session_id: "s", observable_outcome: { kind: "test", success: true, command: "bun test" }, neutral_exposure_enabled: false })).toMatchObject({ outcome: "none", reason: "no_demonstrably_relevant_memory" });
  });

  test("never infers implicit success from failure, silence, or unsupported tools", () => {
    const selected = [record("mem_test", "Run focused tests.")];
    expect(decideReinforcementLink({ selected_memory: selected, session_id: "s", neutral_exposure_enabled: false })).toMatchObject({ outcome: "none" });
    expect(decideReinforcementLink({ selected_memory: selected, session_id: "s", observable_outcome: { kind: "test", success: false, command: "bun test" }, neutral_exposure_enabled: false })).toMatchObject({ outcome: "none", reason: "observable_outcome_failed" });
    expect(decideReinforcementLink({ selected_memory: selected, session_id: "s", observable_outcome: { kind: "tool", success: true, command: "echo hello" }, neutral_exposure_enabled: false })).toMatchObject({ outcome: "none", reason: "unsupported_operation_class" });
  });

  test("neutral exposure is disabled by default and capped once per memory/session", () => {
    const one = [record("mem_neutral", "Use deterministic retrieval.")];
    expect(decideReinforcementLink({ selected_memory: one, session_id: "s", neutral_exposure_enabled: false })).toMatchObject({ outcome: "none" });
    expect(decideReinforcementLink({ selected_memory: one, session_id: "s", neutral_exposure_enabled: true })).toMatchObject({ outcome: "neutral_exposure", memory_id: "mem_neutral" });
    expect(decideReinforcementLink({ selected_memory: one, session_id: "s", neutral_exposure_enabled: true, existing_events: [createReinforcementEvent({ memory_id: "mem_neutral", outcome: "neutral_exposure", thread_id: "s", now: "2026-07-18T00:00:00Z" })] })).toMatchObject({ outcome: "none" });
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
