import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCandidate } from "../../src/inbox";
import { unsafeAddMemoryRecord as addMemoryRecord } from "../../src/store";
import { curateInbox } from "../../src/curator";
import type { CaptureCandidate, MemoryRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-pi-heur-super-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function oldRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem_direct",
    layer: "L2",
    scope: { type: "global" },
    tags: ["memory", "workflow"],
    statement: "Edit MEMORY.md directly for durable memory",
    evidence: [{ type: "manual", ref: "old", note: "old" }],
    confidence: 0.82,
    stability: "semi-stable",
    created_at: "2026-05-01",
    updated_at: "2026-05-01",
    review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If contradicted, revise." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id: "cap_patch",
    created_at: "2026-05-09T00:00:00Z",
    source: { type: "manual", ref: "daily" },
    text: "No longer edit MEMORY.md directly; use patch files instead",
    tags: ["memory", "workflow"],
    evidence_refs: ["a", "b"],
    confidence: 0.9,
    status: "new",
    ...overrides,
  };
}

describe("heuristic supersede detection", () => {
  test("detects contradiction cues with overlapping memory identity", () => {
    const dir = root();
    addMemoryRecord(dir, oldRecord());
    appendCandidate(dir, candidate());
    const patch = curateInbox(dir, { now: "2026-05-09T00:00:00Z", mode: "propose" });
    expect(patch.ops[0].op).toBe("supersede");
    expect(patch.ops[0].target_id).toBe("mem_direct");
  });

  test("does not heuristically supersede a memory from a different project", () => {
    const dir = root();
    addMemoryRecord(dir, oldRecord({
      id: "mem_golf_verifier",
      scope: { type: "project", project: "golf-supplies" },
      tags: ["release", "verification"],
      statement: "Modify the remote branch during vendor verification and return one consolidated report.",
    }));
    appendCandidate(dir, candidate({
      id: "cap_pi_verifier",
      text: "No longer modify the remote branch during PI verification; use local exact-SHA checks instead and return one consolidated report.",
      tags: ["release", "verification"],
      scope_targets: [{ type: "project", project: "pi-persistent-intelligence", confidence: 0.95, basis: ["explicit_project"] }],
    }));

    const patch = curateInbox(dir, { now: "2026-05-09T00:00:00Z", mode: "propose" });

    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0].op).toBe("add");
    expect(patch.ops[0].risk).toBe("low");
  });

  test("generic verifier vocabulary does not establish supersession identity", () => {
    const dir = root();
    addMemoryRecord(dir, oldRecord({
      id: "mem_release_report",
      scope: { type: "project", project: "pi-persistent-intelligence" },
      tags: ["release", "verification"],
      statement: "Include the local release verification report with branch and test results.",
    }));
    appendCandidate(dir, candidate({
      id: "cap_release_artifacts",
      text: "No longer rerun local release verification after the report; use the existing artifacts instead.",
      tags: ["release", "verification"],
      scope_targets: [{ type: "project", project: "pi-persistent-intelligence", confidence: 0.95, basis: ["explicit_project"] }],
    }));

    const patch = curateInbox(dir, { now: "2026-05-09T00:00:00Z", mode: "propose" });

    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0].op).toBe("add");
    expect(patch.ops[0].risk).toBe("low");
  });
});
