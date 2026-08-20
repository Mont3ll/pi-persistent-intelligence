import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { curateInbox } from "../../src/curator";
import { appendCandidate, listCandidates } from "../../src/inbox";
import { applyPatch } from "../../src/patch";
import type { CaptureCandidate, CaptureScopeTarget } from "../../src/types";

const dirs: string[] = [];
function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-group-curation-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

function candidate(scopes: CaptureScopeTarget[], global = false): CaptureCandidate {
  return {
    id: global ? "cap_global" : "cap_grouped",
    created_at: "2026-07-26T00:00:00Z",
    source: { type: "manual", ref: "session:s1:t1", cwd: "/vault" },
    text: global ? "Avoid em dashes in public writing." : "Run release audit before publishing.",
    tags: ["capture", global ? "user_preference" : "workflow_playbook"],
    evidence_refs: ["session:s1:t1"],
    confidence: 0.9,
    status: "new",
    ruleType: global ? "avoid_pattern" : "workflow",
    memory_kind: "instruction",
    primary_trust_class: "direct_user_instruction",
    durability_signal: global ? "user_global" : "project",
    promotion_eligibility: global ? "review_only" : "auto_candidate",
    poisoning_risk: "low",
    poisoning_risk_reasons: [],
    capture_group_id: global ? "group_global" : "group_project",
    capture_intent: global ? "user_preference" : "workflow_playbook",
    scope_targets: scopes,
    proposed_applies_when: global ? ["writing"] : ["release"],
  };
}

describe("capture group curation", () => {
  test("creates one project record per proposed target", () => {
    const dir = root();
    appendCandidate(dir, candidate([
      { type: "project", project: "repo-a", confidence: 0.9, basis: ["modified_project"] },
      { type: "project", project: "repo-b", confidence: 0.9, basis: ["modified_project"] },
    ]));
    const patch = curateInbox(dir, { now: "2026-07-26T00:00:00Z", mode: "propose", minEvidenceCount: 1 });
    expect(patch.ops.map((op) => op.record?.scope)).toEqual([
      { type: "project", project: "repo-a" },
      { type: "project", project: "repo-b" },
    ]);
    expect(new Set(patch.ops.map((op) => op.candidate_id))).toEqual(new Set(["cap_grouped"]));
    expect(new Set(patch.ops.map((op) => op.record?.id)).size).toBe(2);
    expect(patch.ops.map((op) => op.record?.normalized_key)).toEqual([
      "v2|legacy|project|repo-a|run-release-audit-before-publishing|workflow",
      "v2|legacy|project|repo-b|run-release-audit-before-publishing|workflow",
    ]);
  });

  test("derives a separate normalized key for every domain target", () => {
    const dir = root();
    appendCandidate(dir, candidate([
      { type: "domain", domain: "health", confidence: 0.9, basis: ["explicit_domain"] },
      { type: "domain", domain: "education", confidence: 0.9, basis: ["explicit_domain"] },
    ]));
    const patch = curateInbox(dir, { now: "2026-07-26T00:00:00Z", mode: "propose", minEvidenceCount: 1 });

    expect(patch.ops.map((op) => op.record?.normalized_key)).toEqual([
      "v2|legacy|domain|health|run-release-audit-before-publishing|workflow",
      "v2|legacy|domain|education|run-release-audit-before-publishing|workflow",
    ]);
  });

  test("keeps grouped candidate pending after partial project approval", () => {
    const dir = root();
    appendCandidate(dir, candidate([
      { type: "project", project: "repo-a", confidence: 0.9, basis: ["modified_project"] },
      { type: "project", project: "repo-b", confidence: 0.9, basis: ["modified_project"] },
    ]));
    const patch = curateInbox(dir, { now: "2026-07-26T00:00:00Z", mode: "propose", minEvidenceCount: 1 });
    applyPatch(dir, patch, { selectedOpIds: [patch.ops[0].op_id], now: "2026-07-26T00:01:00Z" });
    expect(listCandidates(dir)[0].status).toBe("new");
    const remaining = curateInbox(dir, { now: "2026-07-26T00:02:00Z", mode: "propose", minEvidenceCount: 1 });
    expect(remaining.ops).toHaveLength(1);
    expect(remaining.ops[0].record?.scope).toEqual({ type: "project", project: "repo-b" });
    applyPatch(dir, remaining, { selectedOpIds: [remaining.ops[0].op_id], now: "2026-07-26T00:03:00Z" });
    expect(listCandidates(dir)[0].status).toBe("patched");
  });

  test("marks grouped candidate patched after every project target is applied", () => {
    const dir = root();
    appendCandidate(dir, candidate([
      { type: "project", project: "repo-a", confidence: 0.9, basis: ["modified_project"] },
      { type: "project", project: "repo-b", confidence: 0.9, basis: ["modified_project"] },
    ]));
    const patch = curateInbox(dir, { now: "2026-07-26T00:00:00Z", mode: "propose", minEvidenceCount: 1 });
    applyPatch(dir, patch, { selectedOpIds: patch.ops.map((op) => op.op_id), now: "2026-07-26T00:01:00Z" });
    expect(listCandidates(dir)[0].status).toBe("patched");
  });

  test("creates a global record with applicability and disables silent auto-selection", () => {
    const dir = root();
    appendCandidate(dir, candidate([{ type: "global", confidence: 0.95, basis: ["explicit_user_global"] }], true));
    const patch = curateInbox(dir, { now: "2026-07-26T00:00:00Z", mode: "auto", minEvidenceCount: 1 });
    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0].record?.scope).toEqual({ type: "global" });
    expect(patch.ops[0].record?.applies_when).toEqual(["writing"]);
    expect(patch.ops[0].default_selected).toBe(false);
  });
});
