import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCandidate } from "../../src/inbox";
import { addMemoryRecord } from "../../src/store";
import { curateInbox } from "../../src/curator";
import type { CaptureCandidate, MemoryRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-pi-heur-super-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function oldRecord(): MemoryRecord { return { id: "mem_direct", layer: "L2", scope: { type: "global" }, tags: ["memory", "workflow"], statement: "Edit MEMORY.md directly for durable memory", evidence: [{ type: "manual", ref: "old", note: "old" }], confidence: 0.82, stability: "semi-stable", created_at: "2026-05-01", updated_at: "2026-05-01", review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If contradicted, revise." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null }; }
function candidate(): CaptureCandidate { return { id: "cap_patch", created_at: "2026-05-09T00:00:00Z", source: { type: "manual", ref: "daily" }, text: "No longer edit MEMORY.md directly; use patch files instead", tags: ["memory", "workflow"], evidence_refs: ["a", "b"], confidence: 0.9, status: "new" }; }

describe("heuristic supersede detection", () => {
  test("detects contradiction cues with overlapping tags", () => {
    const dir = root();
    addMemoryRecord(dir, oldRecord());
    appendCandidate(dir, candidate());
    const patch = curateInbox(dir, { now: "2026-05-09T00:00:00Z", mode: "propose" });
    expect(patch.ops[0].op).toBe("supersede");
    expect(patch.ops[0].target_id).toBe("mem_direct");
  });
});
