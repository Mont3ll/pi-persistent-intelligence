import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCandidate, listCandidates } from "../../src/inbox";
import { loadActiveRecords, unsafeAddMemoryRecord as addMemoryRecord } from "../../src/store";
import { curateInbox } from "../../src/curator";
import { applyPatch } from "../../src/patch";
import type { CaptureCandidate, MemoryRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-pi-curator-super-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function record(): MemoryRecord { return { id: "mem_old", layer: "L2", scope: { type: "global" }, tags: ["workflow"], statement: "Use direct markdown edits for memory", evidence: [{ type: "manual", ref: "old", note: "old" }], confidence: 0.8, stability: "semi-stable", created_at: "2026-05-01", updated_at: "2026-05-01", review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If superseded, revise." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null }; }
function candidate(): CaptureCandidate { return { id: "cap_new", created_at: "2026-05-09T00:00:00Z", source: { type: "manual", ref: "daily" }, text: "Use patch files before mutating canonical memory", tags: ["workflow", "supersedes:mem_old"], evidence_refs: ["a", "b"], confidence: 0.9, status: "new" }; }

describe("curator supersede detection", () => {
  test("emits supersede op when candidate explicitly references an active memory id", () => {
    const dir = root();
    addMemoryRecord(dir, record());
    appendCandidate(dir, candidate());
    const patch = curateInbox(dir, { now: "2026-05-09T00:00:00Z", mode: "propose" });
    expect(patch.ops[0].op).toBe("supersede");
    expect(patch.ops[0].target_id).toBe("mem_old");
    expect(patch.ops[0].to_record?.statement).toContain("patch files");
  });

  test("applying a supersede op marks its source candidate patched", () => {
    const dir = root();
    addMemoryRecord(dir, record());
    appendCandidate(dir, candidate());
    const patch = curateInbox(dir, { now: "2026-05-09T00:00:00Z", mode: "propose" });

    const applied = applyPatch(dir, patch, { selectedOpIds: ["op_001"], now: "2026-05-09T00:00:00Z" });

    expect(applied.applied_ops).toEqual(["op_001"]);
    expect(loadActiveRecords(dir).some((r) => r.id === "mem_new")).toBe(true);
    expect(listCandidates(dir).find((c) => c.id === "cap_new")?.status).toBe("patched");
  });

  test("selected supersede ops that become non-applicable do not remain new", () => {
    const dir = root();
    addMemoryRecord(dir, record());
    appendCandidate(dir, candidate());
    appendCandidate(dir, { ...candidate(), id: "cap_other", text: "Use a reviewed patch workflow", tags: ["workflow", "supersedes:mem_old"] });
    const patch = curateInbox(dir, { now: "2026-05-09T00:00:00Z", mode: "propose" });

    const applied = applyPatch(dir, patch, { selectedOpIds: ["op_001", "op_002"], now: "2026-05-09T00:00:00Z" });

    expect(applied.applied_ops).toEqual(["op_001"]);
    expect(applied.skipped_ops).toEqual(["op_002"]);
    expect(listCandidates(dir).find((c) => c.id === "cap_other")?.status).toBe("rejected");
  });
});
