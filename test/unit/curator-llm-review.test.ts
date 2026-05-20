import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCandidate } from "../../src/inbox";
import { unsafeAddMemoryRecord as addMemoryRecord } from "../../src/store";
import { curateInboxWithLlmReview } from "../../src/curator";
import type { CaptureCandidate, MemoryRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-pi-llm-review-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function oldRecord(): MemoryRecord { return { id: "mem_old", layer: "L2", scope: { type: "global" }, tags: ["memory"], statement: "Use markdown files as the durable memory store", evidence: [{ type: "manual", ref: "old", note: "old" }], confidence: 0.82, stability: "semi-stable", created_at: "2026-05-01", updated_at: "2026-05-01", review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If contradicted, revise." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null }; }
function candidate(): CaptureCandidate { return { id: "cap_jsonl", created_at: "2026-05-09T00:00:00Z", source: { type: "manual", ref: "daily" }, text: "Canonical memory should live in governed JSONL records", tags: ["memory"], evidence_refs: ["a", "b"], confidence: 0.9, status: "new" }; }

describe("LLM contradiction review", () => {
  test("uses explicit LLM review output for ambiguous candidates", async () => {
    const dir = root();
    addMemoryRecord(dir, oldRecord());
    appendCandidate(dir, candidate());
    const script = join(dir, "review.js");
    writeFileSync(script, "process.stdin.on('data', () => console.log(JSON.stringify({ contradictions: [{ candidate_id: 'cap_jsonl', target_id: 'mem_old', confidence: 0.91, reason: 'LLM judged JSONL store supersedes markdown store' }] })));", "utf-8");
    const patch = await curateInboxWithLlmReview(dir, { now: "2026-05-09T00:00:00Z", mode: "propose" }, { enabled: true, model: "external/reviewer", command: `node ${script}` });
    expect(patch.ops[0].op).toBe("supersede");
    expect(patch.ops[0].target_id).toBe("mem_old");
    expect(patch.ops[0].reason).toContain("LLM judged");
  });
});
