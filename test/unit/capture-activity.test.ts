import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSessionActivity, collectSessionActivity, listSessionActivity } from "../../src/capture-activity";
import { defaultConfig } from "../../src/config";
import type { ProjectIdentity } from "../../src/types";

const dirs: string[] = [];
function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-capture-activity-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

function resolver(path: string): ProjectIdentity {
  const match = path.match(/\/projects\/([^/]+)/);
  const name = match?.[1] ?? "vault";
  return { project_id: name, display_name: name, source: "git_root", git_root: `/projects/${name}` };
}

describe("capture activity", () => {
  test("tracks every materially affected repository and separates read-only sources", () => {
    const activity = collectSessionActivity({
      session_id: "s1",
      turn_id: "t1",
      launch_cwd: "/vault",
      actions: [
        { kind: "read", path: "/projects/reference/README.md" },
        { kind: "write", path: "/projects/a/src/a.ts" },
        { kind: "command", cwd: "/projects/b", command: "cargo test" },
      ],
      resolver,
      now: "2026-07-26T00:00:00Z",
    });
    expect(activity.modified_projects.map((item) => item.project_id).sort()).toEqual(["a", "b"]);
    expect(activity.read_projects.map((item) => item.project_id)).toEqual(["reference"]);
  });

  test("stores hashes instead of private paths and redacts secret-bearing command details", () => {
    const activity = collectSessionActivity({
      session_id: "s1",
      turn_id: "t1",
      launch_cwd: "/home/mel/Documents/Obsidian Vault",
      actions: [{ kind: "command", cwd: "/projects/a", command: "deploy --token sk-secret-value" }],
      resolver,
      now: "2026-07-26T00:00:00Z",
    });
    const serialized = JSON.stringify(activity);
    expect(serialized).not.toContain("/home/mel/");
    expect(serialized).not.toContain("sk-secret-value");
    expect(serialized).not.toContain("/projects/a");
    expect(activity.modified_projects[0].git_root).toBeUndefined();
    expect(activity.launch_cwd_hash).toHaveLength(64);
  });

  test("deduplicates projects and enforces retention count", () => {
    const dir = root();
    const config = { ...defaultConfig, capture: { ...defaultConfig.capture, activityRetentionCount: 10, activityRetentionDays: 30 } };
    for (let index = 0; index < 12; index++) {
      const activity = collectSessionActivity({
        session_id: "s1",
        turn_id: `t${index}`,
        launch_cwd: "/vault",
        actions: [
          { kind: "write", path: "/projects/a/file.ts" },
          { kind: "write", path: "/projects/a/other.ts" },
        ],
        resolver,
        now: `2026-07-${String(10 + index).padStart(2, "0")}T00:00:00Z`,
      });
      expect(activity.modified_projects).toHaveLength(1);
      appendSessionActivity(dir, activity, config);
    }
    expect(listSessionActivity(dir, "s1")).toHaveLength(10);
  });
});
