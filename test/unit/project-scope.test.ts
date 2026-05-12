import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addMemoryRecord, loadAllRecords, loadProjectRecords } from "../../src/store";
import { renderMemoryToDisk } from "../../src/render";
import type { MemoryRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-pi-project-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function record(id: string): MemoryRecord {
  return { id, layer: "L2", scope: { type: "project", project: "My App" }, tags: ["project"], statement: "Project-specific playbook", evidence: [{ type: "manual", ref: "x", note: "n" }], confidence: 0.8, stability: "semi-stable", created_at: "2026-05-09", updated_at: "2026-05-09", review: { cadence_days: 30, next_review: "2026-06-08", change_condition: "If project changes, revise." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null };
}

describe("project-scope memory", () => {
  test("stores project-scoped L2 records under memory/projects", () => {
    const dir = root();
    addMemoryRecord(dir, record("mem_project"));
    const file = join(dir, "memory", "projects", "my-app.jsonl");
    expect(existsSync(file)).toBe(true);
    expect(loadProjectRecords(dir, "My App").map((r) => r.id)).toEqual(["mem_project"]);
    expect(loadAllRecords(dir).map((r) => r.id)).toContain("mem_project");
  });

  test("renders project markdown projections", () => {
    const dir = root();
    addMemoryRecord(dir, record("mem_project"));
    renderMemoryToDisk(dir);
    const file = join(dir, "rendered", "projects", "my-app.md");
    expect(readFileSync(file, "utf-8")).toContain("Project-specific playbook");
  });
});
