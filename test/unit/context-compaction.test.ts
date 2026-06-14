import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { runContextCompactionConsolidation } from "../../src/context-compaction";
import { readEvidenceRecords } from "../../src/evidence";
import { listCandidates } from "../../src/inbox";
import { readOpenInquiries } from "../../src/inquiries";

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

  test("adds worth metadata and turns ambiguous important observations into inquiries", () => {
    const dir = root();
    const result = runContextCompactionConsolidation(dir, { resource_id: "r", profile_id: "p", thread_id: "t", now: "2026-06-01T00:00:00Z", observations: [
      { text: "The deployment process is critical but unclear.", tags: ["release"], trust_class: "single_session_observation", durability_signal: "project" },
      { text: "Always run bun test before committing.", tags: ["testing"], trust_class: "direct_user_instruction", durability_signal: "project" },
    ] });
    expect(result.candidates_added).toBe(1);
    expect(result.inquiries_created).toBe(1);
    const candidates = listCandidates(dir);
    expect(candidates[0].worth_decision).toBe("candidate");
    expect(candidates[0].worth_score).toBeGreaterThan(0);
    expect(readOpenInquiries(dir)[0].question).toContain("critical but unclear");
    rmSync(dir, { recursive: true, force: true });
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
