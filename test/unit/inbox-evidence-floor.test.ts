import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceCandidates } from "../../src/inbox";
import { curateInbox } from "../../src/curator";
import type { CaptureCandidate } from "../../src/types";

const roots: string[] = [];
afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0; });

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-evidence-floor-"));
  roots.push(dir);
  return dir;
}

function candidate(refs: string[]): CaptureCandidate {
  return {
    id: "cap_evidence_floor",
    created_at: "2026-10-16T10:00:00Z",
    source: { type: "direct_user_instruction", ref: "session:s1:turn:t1" },
    text: "For this project, always use the verified release checklist",
    tags: ["release", "policy"],
    evidence_refs: refs,
    confidence: 0.94,
    status: "new",
    primary_trust_class: "direct_user_instruction",
    promotion_eligibility: "auto_candidate",
    poisoning_risk: "low",
    durability_signal: "project",
    scope_targets: [{ type: "project", project: "pi", confidence: 0.9, basis: ["fixture"] }],
  };
}

describe("inbox auto and manual evidence floors", () => {
  test("auto mode respects configured two-reference default", () => {
    const dir = root();
    replaceCandidates(dir, [candidate(["source-1"])]);
    const patch = curateInbox(dir, { now: "2026-10-16T10:01:00Z", mode: "auto" });
    expect(patch.ops).toHaveLength(0);
  });

  test("manual review can propose a single source but cannot preselect it", () => {
    const dir = root();
    replaceCandidates(dir, [candidate(["source-1"])]);
    const patch = curateInbox(dir, { now: "2026-10-16T10:01:00Z", mode: "supervised", minEvidenceCount: 1 });
    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0]?.default_selected).toBe(false);
    expect(patch.ops[0]?.rationale).toContain("Below configured auto-apply evidence floor");
  });

  test("auto mode can propose two-reference candidates while retaining trust checks", () => {
    const dir = root();
    replaceCandidates(dir, [candidate(["source-1", "source-2"])]);
    const patch = curateInbox(dir, { now: "2026-10-16T10:01:00Z", mode: "auto" });
    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0]?.candidate_id).toBe("cap_evidence_floor");
  });
});
