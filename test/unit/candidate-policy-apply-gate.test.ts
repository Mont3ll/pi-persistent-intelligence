import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCandidate, listCandidates } from "../../src/inbox";
import { curateInbox } from "../../src/curator";
import { applyPatch } from "../../src/patch";
import { loadActiveRecords } from "../../src/store";
import type { CaptureCandidate, MemoryWorthDecision } from "../../src/types";

const roots: string[] = [];
afterEach(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); roots.length = 0; });
function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-policy-apply-")); roots.push(dir); return dir; }

function seed(dir: string, text: string, worth: MemoryWorthDecision = "candidate"): void {
  const c: CaptureCandidate = {
    id: "cap_policy_test", created_at: "2026-10-21T10:00:00Z",
    source: { type: "manual", ref: "fixture" }, text,
    tags: ["testing"], evidence_refs: ["fixture-a", "fixture-b"],
    confidence: 0.94, status: "new",
    capture_intent: "behavior_correction",
    worth_decision: worth,
    primary_trust_class: "direct_user_instruction",
    durability_signal: "project",
    promotion_eligibility: "auto_candidate",
    poisoning_risk: "low",
    scope_targets: [{ type: "project", project: "pi", confidence: 0.9, basis: ["test"] }],
  };
  appendCandidate(dir, c);
}

function manuallyApply(dir: string) {
  const patch = curateInbox(dir, { now: "2026-10-21T10:01:00Z", mode: "supervised" });
  expect(patch.ops).toHaveLength(1);
  return applyPatch(dir, patch, { selectedOpIds: [patch.ops[0]!.op_id], now: "2026-10-21T10:02:00Z" });
}

describe("capture policy at governed apply boundary", () => {
  test("worth_decision=reject blocks explicit manual promotion and keeps candidate for review", () => {
    const dir = root();
    seed(dir, "For this project, always use the verified release checklist.", "reject");
    const result = manuallyApply(dir);
    expect(result.applied_ops).toHaveLength(0);
    expect(result.skipped_ops).toContainEqual(expect.objectContaining({ reason: "capture_policy_hold" }));
    expect(loadActiveRecords(dir)).toHaveLength(0);
    expect(listCandidates(dir).find((c) => c.id === "cap_policy_test")?.status).toBe("new");
  });

  test("reclassified task-bound instruction cannot become L2 through manual apply", () => {
    const dir = root();
    seed(dir, "Verify the final release and do not modify source. Do not publish or merge.");
    const result = manuallyApply(dir);
    expect(result.applied_ops).toHaveLength(0);
    expect(result.skipped_ops).toContainEqual(expect.objectContaining({ reason: "capture_policy_hold" }));
    expect(loadActiveRecords(dir)).toHaveLength(0);
    expect(listCandidates(dir).find((c) => c.id === "cap_policy_test")?.status).toBe("new");
  });

  test("edited patch statement cannot turn a durable candidate into task-bound memory", () => {
    const dir = root();
    seed(dir, "For this project, always use the verified release checklist.");
    const patch = curateInbox(dir, { now: "2026-10-21T10:01:00Z", mode: "supervised" });
    expect(patch.ops).toHaveLength(1);
    patch.ops[0]!.record!.statement = "Verify the final release and do not modify source. Do not publish or merge.";
    const result = applyPatch(dir, patch, { selectedOpIds: [patch.ops[0]!.op_id], now: "2026-10-21T10:02:00Z" });
    expect(result.applied_ops).toHaveLength(0);
    expect(result.skipped_ops).toContainEqual(expect.objectContaining({ reason: "capture_policy_hold" }));
    expect(loadActiveRecords(dir)).toHaveLength(0);
  });

  test("missing current durability cue is reviewable, not an explicit rejection", () => {
    const dir = root();
    seed(dir, "Run release audit before publishing.");
    const patch = curateInbox(dir, { now: "2026-10-21T10:01:00Z", mode: "supervised" });
    expect(patch.ops).toHaveLength(1);
    const result = applyPatch(dir, patch, {
      selectedOpIds: [patch.ops[0]!.op_id], now: "2026-10-21T10:02:00Z",
    });
    expect(result.applied_ops).toEqual([patch.ops[0]!.op_id]);
    expect(loadActiveRecords(dir)).toHaveLength(1);
    expect(listCandidates(dir).find((c) => c.id === "cap_policy_test")?.status).toBe("patched");
  });

  test("a stale default_selected flag cannot replace explicit review of an ambiguous candidate", () => {
    const dir = root();
    seed(dir, "Run release audit before publishing.");
    const patch = curateInbox(dir, { now: "2026-10-21T10:01:00Z", mode: "supervised" });
    expect(patch.ops).toHaveLength(1);
    patch.ops[0]!.default_selected = true;
    const result = applyPatch(dir, patch, { now: "2026-10-21T10:02:00Z" });
    expect(result.applied_ops).toHaveLength(0);
    expect(result.skipped_ops).toContainEqual(expect.objectContaining({ reason: "capture_policy_hold" }));
    expect(loadActiveRecords(dir)).toHaveLength(0);
    expect(listCandidates(dir).find((c) => c.id === "cap_policy_test")?.status).toBe("new");
  });

  test("a stale auto patch cannot force promotion of a stored-durable no-cue candidate", () => {
    const dir = root();
    seed(dir, "Run release audit before publishing.");
    const patch = curateInbox(dir, { now: "2026-10-21T10:01:00Z", mode: "auto" });
    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0]!.default_selected).toBe(false);
    const result = applyPatch(dir, patch, {
      selectedOpIds: [patch.ops[0]!.op_id], now: "2026-10-21T10:02:00Z",
    });
    expect(result.applied_ops).toHaveLength(0);
    expect(result.skipped_ops).toContainEqual(expect.objectContaining({ reason: "capture_policy_hold" }));
    expect(loadActiveRecords(dir)).toHaveLength(0);
    expect(listCandidates(dir).find((c) => c.id === "cap_policy_test")?.status).toBe("new");
  });

  test("currently durable candidate remains manually approvable", () => {
    const dir = root();
    seed(dir, "For this project, always use the verified release checklist.");
    const result = manuallyApply(dir);
    expect(result.applied_ops).toHaveLength(1);
    expect(loadActiveRecords(dir)).toHaveLength(1);
    expect(listCandidates(dir).find((c) => c.id === "cap_policy_test")?.status).toBe("patched");
  });
});
