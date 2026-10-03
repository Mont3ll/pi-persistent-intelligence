import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserCommands } from "../../src/commands/browser";
import { listCandidates, replaceCandidates } from "../../src/inbox";
import { unsafeAddMemoryRecord as addMemoryRecord } from "../../src/store";
import type { CaptureCandidate, MemoryRecord } from "../../src/types";

let roots: string[] = [];
const originalPath = process.env.PATH;

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-browser-test-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  process.env.PATH = originalPath;
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  roots = [];
});

function candidate(id: string, text: string, overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id,
    created_at: "2026-09-03T08:00:00.000Z",
    source: { type: "manual", ref: `test:${id}` },
    text,
    tags: ["testing"],
    evidence_refs: ["test-evidence"],
    confidence: 0.9,
    status: "new",
    scope_targets: [{ type: "project", project: "pi", confidence: 0.9, basis: ["test_fixture"] }],
    ...overrides,
  };
}

function deprecatedMemory(id: string, statement: string): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "project", project: "pi" },
    tags: ["testing"],
    statement,
    evidence: [{ type: "manual", ref: "test-existing", note: "existing fixture" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-09-01",
    updated_at: "2026-09-01",
    review: { cadence_days: 30, next_review: "2026-10-01", change_condition: "If contradicted, revise." },
    status: "deprecated",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
  };
}

function browserCommands(dir: string) {
  return createBrowserCommands({
    getRoot: () => dir,
    getCommandHistory: () => [],
    getFtsIndex: () => ({} as any),
    nowIso: () => "2026-09-03T09:00:00.000Z",
    rememberCommand() {},
    syncFtsAfterPatch() {},
  });
}

type Notification = { message: string; kind?: string };

function interactiveContext(results: unknown[], notifications: Notification[]) {
  let index = 0;
  return {
    ui: {
      custom: async () => results[index++] as any,
      notify(message: string, kind?: string) {
        notifications.push({ message, kind });
      },
    },
  } as any;
}

function seedPartialApply(dir: string): void {
  replaceCandidates(dir, [
    candidate("cap_ok", "Remember the verified curation behavior"),
    candidate("cap_dup", "Remember this duplicate fixture"),
  ]);
  addMemoryRecord(dir, deprecatedMemory("mem_dup", "Existing duplicate fixture"));
}

describe("browser command factory", () => {
  test("exposes history, inbox, and learnings definitions", () => {
    const commands = browserCommands("/tmp/pi-browser-test");
    expect(Object.keys(commands)).toEqual(["memoryHistory", "memoryInbox", "memoryLearnings"]);
  });

  test("interactive inbox approve reports receipt-confirmed applied and skipped counts", async () => {
    const dir = root();
    seedPartialApply(dir);
    process.env.PATH = ""; // make optional qmd refresh fail immediately without touching a real collection
    const notifications: Notification[] = [];

    await browserCommands(dir).memoryInbox.handler("", interactiveContext([{ action: "approve" }], notifications));

    expect(notifications.at(-1)).toEqual({
      message: "✓ Applied 1 memory op(s); 1 skipped for review.",
      kind: "success",
    });
  });

  test("interactive inbox review reports receipt-confirmed applied and skipped counts", async () => {
    const dir = root();
    seedPartialApply(dir);
    process.env.PATH = ""; // make optional qmd refresh fail immediately without touching a real collection
    const notifications: Notification[] = [];

    await browserCommands(dir).memoryInbox.handler(
      "",
      interactiveContext([{ action: "review" }, ["op_001", "op_002"]], notifications),
    );

    expect(notifications.at(-1)).toEqual({
      message: "✓ Applied 1 memory op(s); 1 skipped for review.",
      kind: "success",
    });
  });

  test("interactive inbox approve warns when every selected operation is skipped", async () => {
    const dir = root();
    replaceCandidates(dir, [
      candidate("cap_dup1", "Duplicate fixture one"),
      candidate("cap_dup2", "Duplicate fixture two"),
    ]);
    addMemoryRecord(dir, deprecatedMemory("mem_dup1", "Existing duplicate one"));
    addMemoryRecord(dir, deprecatedMemory("mem_dup2", "Existing duplicate two"));
    process.env.PATH = ""; // make optional qmd refresh fail immediately without touching a real collection
    const notifications: Notification[] = [];

    await browserCommands(dir).memoryInbox.handler("", interactiveContext([{ action: "approve" }], notifications));

    expect(notifications.at(-1)).toEqual({
      message: "Applied 0 memory op(s); 2 skipped for review.",
      kind: "warning",
    });
  });

  test("interactive inbox approve leaves review-only candidates for explicit review", async () => {
    const dir = root();
    replaceCandidates(dir, [candidate("cap_review_only", "Proceed with this one release closure only", {
      primary_trust_class: "direct_user_instruction",
      source_trust_weight: 1,
      durability_signal: "project",
      promotion_eligibility: "review_only",
      poisoning_risk: "low",
      poisoning_risk_reasons: [],
      capture_intent: "behavior_correction",
    })]);
    process.env.PATH = "";
    const notifications: Notification[] = [];

    await browserCommands(dir).memoryInbox.handler("", interactiveContext([{ action: "approve" }], notifications));

    expect(notifications.at(-1)).toEqual({
      message: "No auto-eligible ops above confidence threshold.",
      kind: "info",
    });
    expect(listCandidates(dir).find((item) => item.id === "cap_review_only")?.status).toBe("new");
  });
});
