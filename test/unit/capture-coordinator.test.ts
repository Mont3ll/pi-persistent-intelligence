import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processCaptureTurn } from "../../src/capture-coordinator";
import { listCandidates } from "../../src/inbox";
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
