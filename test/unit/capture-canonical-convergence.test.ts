import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processCaptureTurn, listCaptureEvents } from "../../src/capture-coordinator";
import { buildCaptureQualityReport } from "../../src/capture-quality";
import { listCandidates } from "../../src/inbox";
import { readEvidenceRecords } from "../../src/evidence";
import { unsafeAddMemoryRecord } from "../../src/store";
import { findExactActiveCanonical } from "../../src/capture-recurrence";
import type { MemoryRecord, ProjectIdentity } from "../../src/types";

const roots: string[] = [];
afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0; });
const resolver = (cwd: string): ProjectIdentity => {
  const project_id = cwd.includes("repo-b") ? "repo-b" : "repo-a";
  return { project_id, source: "package_name", package_name: project_id };
};
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-canonical-convergence-"));
  roots.push(dir);
  return dir;
}
function active(
  id: string,
  statement: string,
  scope: MemoryRecord["scope"] = { type: "global" },
  status: MemoryRecord["status"] = "active",
): MemoryRecord {
  return {
    id, layer: "L2", scope, tags: ["writing"], statement, confidence: 0.94,
    stability: "semi-stable", status,
    evidence: [{ type: "manual", ref: "fixture-original", note: "accepted source" }],
    created_at: "2026-10-01", updated_at: "2026-10-01",
    review: { cadence_days: 30, next_review: "2026-11-01", change_condition: "If changed." },
    supersedes: [], superseded_by: [], vault_ref: null,
  };
}
function capture(dir: string, message: string, turnId: string, cwd = "/projects/repo-a") {
  return processCaptureTurn(dir, {
    session_id: `session-${turnId}`, turn_id: turnId, message,
    launch_cwd: cwd, actions: [], resolver,
    now: "2026-10-28T07:00:00Z",
  });
}

describe("capture convergence against governed active canonical memory", () => {
  test("six sessions repeating the same already-active preference add no inbox candidates or evidence", () => {
    const dir = root();
    const statement = "Avoid em dashes in my public writing.";
    unsafeAddMemoryRecord(dir, active("mem_existing", statement));
    for (let i = 0; i < 6; i++) {
      const result = capture(dir, statement, `t${i}`);
      expect(result.already_represented).toBe(1);
      expect(result.candidates_created).toBe(0);
      expect(result.candidates_reinforced).toBe(0);
    }
    expect(listCandidates(dir)).toHaveLength(0);
    expect(readEvidenceRecords(dir)).toHaveLength(0);
    expect(listCaptureEvents(dir)).toHaveLength(6);
    expect(listCaptureEvents(dir).every((event) => event.outcome === "candidate_already_represented")).toBe(true);
    expect(buildCaptureQualityReport(dir).funnel.candidate_already_represented).toBe(6);
  });

  test("an exact statement in another project does not suppress capture", () => {
    const dir = root();
    const statement = "For this project, always use the accepted release checklist.";
    unsafeAddMemoryRecord(dir, active("mem_project_a", statement, { type: "project", project: "repo-a" }));
    expect(findExactActiveCanonical(dir, statement, [{ type: "project", project: "repo-b", confidence: 0.95, basis: ["test"] }])).toBeNull();
    const result = capture(dir, statement, "other", "/projects/repo-b");
    expect(result.already_represented).toBe(0);
    expect(result.candidates_created).toBe(1);
    expect(listCandidates(dir)).toHaveLength(1);
  });

  test("a superseded or deleted record cannot block a new legitimate capture", () => {
    const statement = "Avoid em dashes in my public writing.";
    for (const status of ["superseded", "deleted"] as const) {
      const dir = root();
      unsafeAddMemoryRecord(dir, active(`mem_${status}`, statement, { type: "global" }, status));
      expect(capture(dir, statement, status).candidates_created).toBe(1);
      expect(listCandidates(dir)).toHaveLength(1);
    }
  });

  test("contradictory wording is not collapsed by loose preference normalization", () => {
    const dir = root();
    const oldStatement = "For all my writing, never use em dashes.";
    const changed = "For all my writing, always use em dashes.";
    unsafeAddMemoryRecord(dir, active("mem_old", oldStatement));
    expect(findExactActiveCanonical(dir, changed, [{ type: "global", confidence: 0.95, basis: ["test"] }])).toBeNull();
    const outcome = capture(dir, changed, "correction");
    expect(outcome.already_represented).toBe(0);
    expect(outcome.candidates_created).toBe(1);
  });

  test("ambiguous multi-scope matches are not suppressed", () => {
    const dir = root();
    const statement = "For this project, always use the accepted release checklist.";
    unsafeAddMemoryRecord(dir, active("mem_existing", statement, { type: "project", project: "repo-a" }));
    expect(findExactActiveCanonical(dir, statement, [
      { type: "project", project: "repo-a", confidence: 0.95, basis: ["test"] },
      { type: "project", project: "repo-b", confidence: 0.95, basis: ["test"] },
    ])).toBeNull();
  });
});
