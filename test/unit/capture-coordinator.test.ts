import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCaptureEvents, processCaptureTurn } from "../../src/capture-coordinator";
import { listCandidates } from "../../src/inbox";
import { readEvidenceRecords } from "../../src/evidence";
import type { ProjectIdentity } from "../../src/types";

const dirs: string[] = [];
function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-capture-coordinator-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

function resolver(path: string): ProjectIdentity {
  const match = path.match(/\/projects\/([^/]+)/);
  const project_id = match?.[1] ?? "obsidian-vault";
  return { project_id, source: "package_name", package_name: project_id };
}

describe("capture coordinator", () => {
  test("captures a user-global writing preference once per turn", () => {
    const dir = root();
    const input = {
      session_id: "s1",
      turn_id: "t1",
      message: "Avoid em dashes in my public writing.",
      launch_cwd: "/vault",
      actions: [{ kind: "write" as const, path: "/projects/repo-a/README.md" }],
      resolver,
      now: "2026-07-26T00:00:00Z",
    };
    const first = processCaptureTurn(dir, input);
    const second = processCaptureTurn(dir, input);
    expect(first.candidates_created).toBe(1);
    expect(second.skipped_checkpointed).toBe(true);
    expect(listCandidates(dir)).toHaveLength(1);
    expect(listCandidates(dir)[0].scope_targets).toEqual([{ type: "global", confidence: 0.95, basis: ["explicit_user_global"] }]);
    expect(listCandidates(dir)[0].proposed_applies_when).toContain("writing");
    expect(readEvidenceRecords(dir)).toHaveLength(1);
    expect(listCandidates(dir)[0].evidence_refs).toContain(readEvidenceRecords(dir)[0].id);
    expect(readEvidenceRecords(dir)[0]).toMatchObject({ source_ref: "session:s1:turn:t1", trust_class: "direct_user_instruction" });
  });

  test("reinforces the same preference when repeated in a later turn", () => {
    const dir = root();
    const base = {
      session_id: "s1",
      message: "Avoid em dashes in my public writing.",
      launch_cwd: "/vault",
      actions: [],
      resolver,
      now: "2026-07-26T00:00:00Z",
    };
    processCaptureTurn(dir, { ...base, turn_id: "t1" });
    const repeated = processCaptureTurn(dir, { ...base, turn_id: "t2", now: "2026-07-26T00:01:00Z" });
    expect(repeated.candidates_reinforced).toBe(1);
    expect(listCandidates(dir)).toHaveLength(1);
    expect(listCandidates(dir)[0].recurrence_count).toBe(2);
  });

  test("creates one grouped candidate with every modified repository target", () => {
    const dir = root();
    const result = processCaptureTurn(dir, {
      session_id: "s1",
      turn_id: "t1",
      message: "Before publishing, run the release audit and package dry-run.",
      launch_cwd: "/vault",
      actions: [
        { kind: "write", path: "/projects/repo-a/README.md" },
        { kind: "command", cwd: "/projects/repo-b", command: "cargo test" },
      ],
      resolver,
      now: "2026-07-26T00:00:00Z",
    });
    expect(result.candidates_created).toBe(1);
    expect(listCandidates(dir)[0].scope_targets?.map((target) => target.project).sort()).toEqual(["repo-a", "repo-b"]);
  });

  test("routes a temporary preference to daily-only without a candidate", () => {
    const dir = root();
    const result = processCaptureTurn(dir, {
      session_id: "s1",
      turn_id: "t1",
      message: "For this response, avoid headings and keep it short.",
      launch_cwd: "/vault",
      actions: [],
      resolver,
      now: "2026-07-26T00:00:00Z",
    });
    expect(result.daily_only).toBe(1);
    expect(listCandidates(dir)).toHaveLength(0);
  });

  test("routes task-bound verifier handoffs to daily-only without a candidate", () => {
    const dir = root();
    const result = processCaptureTurn(dir, {
      session_id: "s1",
      turn_id: "t1",
      message: "Verify the RED stage for issue #20. Do not edit production code. Do not implement the fix. Do not tag or publish.",
      launch_cwd: "/projects/pi-persistent-intelligence",
      actions: [],
      resolver,
      now: "2026-10-03T00:00:00Z",
    });
    expect(result.daily_only).toBe(1);
    expect(result.candidates_created).toBe(0);
    expect(listCandidates(dir)).toHaveLength(0);
    expect(readEvidenceRecords(dir)).toHaveLength(0);
  });

  test("routes complete-release handoffs to daily-only without candidate or evidence persistence", () => {
    const dir = root();
    const result = processCaptureTurn(dir, {
      session_id: "release-session",
      turn_id: "release-turn",
      message: "Complete the final verification and release of pi-persistent-intelligence v0.17.3 from the post-documentation merged main commit. This supersedes all earlier v0.17.3 publication prompts. The release must be based only on the exact commit below. Do not mutate the live PI canonical store. Stop immediately on any failed invariant.",
      launch_cwd: "/projects/pi-persistent-intelligence",
      actions: [],
      resolver,
      now: "2026-10-07T08:00:00Z",
    });
    expect(result.daily_only).toBe(1);
    expect(result.candidates_created).toBe(0);
    expect(result.candidates_reinforced).toBe(0);
    expect(listCandidates(dir)).toHaveLength(0);
    expect(readEvidenceRecords(dir)).toHaveLength(0);
    expect(listCaptureEvents(dir).at(-1)?.reason).toBe("temporary_instruction");
  });

  test("honors a daily-only memory-worth decision before evidence or candidate persistence", () => {
    const dir = root();
    const result = processCaptureTurn(dir, {
      session_id: "s1",
      turn_id: "t1",
      message: "Do not modify source today.",
      launch_cwd: "/projects/pi-persistent-intelligence",
      actions: [],
      resolver,
      now: "2026-10-03T00:00:00Z",
    });
    expect(result.daily_only).toBe(1);
    expect(result.candidates_created).toBe(0);
    expect(listCandidates(dir)).toHaveLength(0);
    expect(readEvidenceRecords(dir)).toHaveLength(0);
    expect(listCaptureEvents(dir).at(-1)?.reason).toBe("memory_worth_daily_only");
  });

  test("blocks secret-bearing preferences", () => {
    const dir = root();
    const result = processCaptureTurn(dir, {
      session_id: "s1",
      turn_id: "t1",
      message: "Always use token sk-abcdefghijklmnopqrstuvwxyz123456 for releases.",
      launch_cwd: "/projects/repo-a",
      actions: [],
      resolver,
      now: "2026-07-26T00:00:00Z",
    });
    expect(result.rejected).toBe(1);
    expect(listCandidates(dir)).toHaveLength(0);
  });
});
