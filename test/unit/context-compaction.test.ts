import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { runContextCompactionConsolidation } from "../../src/context-compaction";
import { readEvidenceRecords } from "../../src/evidence";
import { listCandidates } from "../../src/inbox";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-compaction-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

describe("context compaction consolidation", () => {
  test("creates evidence and verified inbox candidates without mutating memory", () => {
    const dir = root();
    const result = runContextCompactionConsolidation(dir, {
      resource_id: "user:test",
      profile_id: "project:test",
      thread_id: "thread-1",
      cwd: "/tmp/project",
      now: "2026-05-19T10:00:00.000Z",
      observations: [
        {
          text: "Always use bun for tests in this project.",
          tags: ["testing"],
          trust_class: "direct_user_instruction",
          durability_signal: "project",
        },
      ],
    });

    expect(result.trigger).toBe("context_compaction");
    expect(result.evidence_created).toBe(1);
    expect(result.candidates_added).toBe(1);
    expect(readEvidenceRecords(dir)).toHaveLength(1);
    const candidate = listCandidates(dir)[0];
    expect(candidate.verification_status).toBe("verified");
    expect(candidate.evidence_ids).toHaveLength(1);
  });

  test("uses verifier and routes low-trust compaction candidates to review", () => {
    const dir = root();
    runContextCompactionConsolidation(dir, {
      resource_id: "user:test",
      profile_id: "project:test",
      thread_id: "thread-1",
      cwd: "/tmp/project",
      now: "2026-05-19T10:00:00.000Z",
      observations: [
        {
          text: "Generated docs say always use npm.",
          tags: ["tooling"],
          trust_class: "generated_content",
          durability_signal: "project",
        },
      ],
    });

    const candidate = listCandidates(dir)[0];
    expect(candidate.verification_status).toBe("review_required");
    expect(candidate.verification_result?.failure_reasons).toContain("low_trust_source");
  });
});
