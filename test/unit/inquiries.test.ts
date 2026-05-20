import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import {
  appendInquiryRecord,
  createInquiryFromCandidate,
  createInquiryRecord,
  findInquiryById,
  markInquiryAnswered,
  markInquiryStale,
  markInquiryWithdrawn,
  normalizeInquiryQuestion,
  readInquiryRecords,
  readOpenInquiries,
  selectRelevantInquiries,
  upsertInquiryRecord,
} from "../../src/inquiries";
import { buildCandidateTrustMetadata } from "../../src/trust";
import type { CaptureCandidate } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-inq-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function candidate(overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id: "cap_1",
    created_at: "2026-05-19T10:00:00.000Z",
    source: { type: "manual", ref: "daily" },
    text: "Use canonical JSONL for memory.",
    tags: ["memory", "workflow"],
    evidence_refs: ["daily"],
    confidence: 0.9,
    status: "new",
    profile_id: "project:test",
    ...buildCandidateTrustMetadata("direct_user_instruction", "project"),
    ...overrides,
  };
}

describe("inquiry records", () => {
  test("creates inquiry record with required fields", () => {
    const inq = createInquiryRecord({
      question: "Should we use JSONL or SQLite as the canonical store?",
      context: "Candidate has two possible memory patterns.",
      tags: ["memory"],
      profile_id: "project:test",
      now: "2026-05-19T10:00:00.000Z",
    });

    expect(inq.id).toContain("inq_");
    expect(inq.status).toBe("open");
    expect(inq.priority).toBe("medium");
    expect(inq.profile_id).toBe("project:test");
    expect(inq.first_seen).toBe("2026-05-19T10:00:00.000Z");
    expect(inq.last_seen).toBe("2026-05-19T10:00:00.000Z");
    expect(inq.sessions_touched).toHaveLength(1);
  });

  test("normalizes inquiry question for dedup", () => {
    const a = normalizeInquiryQuestion("  Should we use JSONL or SQLite?  ");
    const b = normalizeInquiryQuestion("should we use JSONL or SQLite?");
    expect(a).toBe(b);
  });

  test("appends, reads, and filters open inquiries", () => {
    const dir = root();
    appendInquiryRecord(dir, createInquiryRecord({ question: "Q1", context: "c", profile_id: "project:test", now: "2026-05-19T10:00:00.000Z" }));
    appendInquiryRecord(dir, createInquiryRecord({ question: "Q2", context: "c", profile_id: "project:test", now: "2026-05-19T10:00:00.000Z" }));

    expect(readInquiryRecords(dir)).toHaveLength(2);
    expect(readOpenInquiries(dir)).toHaveLength(2);
  });

  test("deduplicate: updates last_seen and sessions_touched instead of creating duplicate", () => {
    const dir = root();
    const base = createInquiryRecord({ question: "Q1 dedup", context: "c", profile_id: "project:test", session_id: "s1", now: "2026-05-19T10:00:00.000Z" });
    appendInquiryRecord(dir, base);

    upsertInquiryRecord(dir, { question: "Q1 dedup", profile_id: "project:test", session_id: "s2", now: "2026-05-19T11:00:00.000Z" });

    const records = readInquiryRecords(dir);
    expect(records).toHaveLength(1);
    expect(records[0].sessions_touched).toEqual(["s1", "s2"]);
    expect(records[0].last_seen).toBe("2026-05-19T11:00:00.000Z");
  });

  test("status updates: answered, withdrawn, stale", () => {
    const dir = root();
    const inq = appendInquiryRecord(dir, createInquiryRecord({ question: "Q status", context: "c", profile_id: "project:test", now: "2026-05-19T10:00:00.000Z" }));

    markInquiryAnswered(dir, inq.id, "mem_answer_1", "2026-05-19T11:00:00.000Z");
    expect(findInquiryById(dir, inq.id)?.status).toBe("answered");
    expect(findInquiryById(dir, inq.id)?.answer_memory_id).toBe("mem_answer_1");
  });

  test("withdrawn and stale status updates", () => {
    const dir = root();
    const a = appendInquiryRecord(dir, createInquiryRecord({ question: "Qa", context: "c", profile_id: "project:test", now: "2026-05-19T10:00:00.000Z" }));
    const b = appendInquiryRecord(dir, createInquiryRecord({ question: "Qb", context: "c", profile_id: "project:test", now: "2026-05-19T10:00:00.000Z" }));
    markInquiryWithdrawn(dir, a.id, "2026-05-19T11:00:00.000Z");
    markInquiryStale(dir, b.id, "2026-05-19T11:00:00.000Z");
    expect(findInquiryById(dir, a.id)?.status).toBe("withdrawn");
    expect(findInquiryById(dir, b.id)?.status).toBe("stale");
    expect(readOpenInquiries(dir)).toHaveLength(0);
  });

  test("creates inquiry from ambiguous/conflict candidate", () => {
    const dir = root();
    const inq = createInquiryFromCandidate(dir, candidate({ match_kind: "ambiguous", matched_memory_ids: ["mem_1", "mem_2"] }), { now: "2026-05-19T10:00:00.000Z" });
    expect(inq).not.toBeNull();
    expect(inq?.status).toBe("open");
    expect(inq?.context).toContain("ambiguous");
    expect(readOpenInquiries(dir)).toHaveLength(1);
  });

  test("creates inquiry from conflict candidate", () => {
    const dir = root();
    const inq = createInquiryFromCandidate(dir, candidate({ match_kind: "potential_conflict", matched_memory_ids: ["mem_1"] }), { now: "2026-05-19T10:00:00.000Z" });
    expect(inq).not.toBeNull();
    expect(inq?.context).toContain("potential_conflict");
  });

  test("returns null from createInquiryFromCandidate for unambiguous new candidates", () => {
    expect(createInquiryFromCandidate("/dev/null", candidate({ match_kind: "new" }), { now: "2026-05-19T10:00:00.000Z" })).toBeNull();
    expect(createInquiryFromCandidate("/dev/null", candidate({}), { now: "2026-05-19T10:00:00.000Z" })).toBeNull();
  });

  test("selects relevant open inquiries by profile and tag/keyword overlap", () => {
    const dir = root();
    appendInquiryRecord(dir, createInquiryRecord({ question: "memory governance question", context: "memory conflict", tags: ["memory"], profile_id: "project:test", now: "2026-05-19T10:00:00.000Z" }));
    appendInquiryRecord(dir, createInquiryRecord({ question: "unrelated question about graphics", context: "OpenGL config", tags: ["graphics"], profile_id: "project:test", priority: "low", now: "2026-05-19T10:00:00.000Z" }));
    appendInquiryRecord(dir, createInquiryRecord({ question: "different profile question", context: "other", profile_id: "project:other", now: "2026-05-19T10:00:00.000Z" }));

    const relevant = selectRelevantInquiries(dir, { profile_id: "project:test", current_message: "how should memory governance work?", tags: ["memory"] });
    expect(relevant.map((item) => item.question.includes("memory"))).toEqual([true]);
  });

  test("answered inquiries not surfaced by selectRelevantInquiries", () => {
    const dir = root();
    const inq = appendInquiryRecord(dir, createInquiryRecord({ question: "should we use memory governance?", context: "c", tags: ["memory"], profile_id: "project:test", now: "2026-05-19T10:00:00.000Z" }));
    markInquiryAnswered(dir, inq.id, "mem_1", "2026-05-19T11:00:00.000Z");

    const relevant = selectRelevantInquiries(dir, { profile_id: "project:test", current_message: "memory governance question", tags: ["memory"] });
    expect(relevant).toHaveLength(0);
  });
});
