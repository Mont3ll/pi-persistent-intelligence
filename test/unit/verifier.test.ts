import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendEvidenceRecord } from "../../src/evidence";
import { appendDeletionTombstone, createDeletionTombstone } from "../../src/tombstones";
import { verifyCandidate } from "../../src/verifier";
import type { CaptureCandidate, EvidenceRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-verify-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "ev_1",
    resource_id: "user:test",
    profile_id: "project:test",
    created_at: "2026-05-19T10:00:00.000Z",
    source_kind: "conversation",
    source_ref: "message",
    source_summary: "User said use bun for tests.",
    source_excerpt: "Please use bun for tests in this project.",
    trust_class: "direct_user_instruction",
    polarity: "supports",
    durability_signal: "project",
    related_memory_ids: [],
    ...overrides,
  };
}

function candidate(overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id: "cap_1",
    created_at: "2026-05-19T10:00:00.000Z",
    source: { type: "manual", ref: "daily" },
    text: "Use bun for tests in this project.",
    tags: ["testing"],
    evidence_refs: ["daily"],
    evidence_ids: ["ev_1"],
    confidence: 0.9,
    status: "new",
    primary_trust_class: "direct_user_instruction",
    durability_signal: "project",
    promotion_eligibility: "auto_candidate",
    poisoning_risk: "low",
    ...overrides,
  };
}

describe("verifyCandidate", () => {
  test("verifies supported high-trust candidate", () => {
    const dir = root();
    appendEvidenceRecord(dir, evidence());
    const result = verifyCandidate(dir, candidate());
    expect(result.supported).toBe(true);
    expect(result.verification_status).toBe("verified");
    expect(result.requires_human_review).toBe(false);
  });

  test("review-routes missing evidence", () => {
    const dir = root();
    const result = verifyCandidate(dir, candidate());
    expect(result.supported).toBe(false);
    expect(result.verification_status).toBe("review_required");
    expect(result.failure_reasons).toContain("missing_evidence");
  });

  test("fails temporary durability for durable L2 promotion", () => {
    const dir = root();
    appendEvidenceRecord(dir, evidence({ durability_signal: "temporary" }));
    const result = verifyCandidate(dir, candidate({ durability_signal: "temporary", promotion_eligibility: "review_only" }));
    expect(result.supported).toBe(false);
    expect(result.failure_reasons).toContain("temporary_durability");
  });

  test("routes low trust and poisoning risk to review", () => {
    const dir = root();
    appendEvidenceRecord(dir, evidence({ trust_class: "repository_text" }));
    const result = verifyCandidate(dir, candidate({ primary_trust_class: "repository_text", promotion_eligibility: "review_only", poisoning_risk: "high" }));
    expect(result.verification_status).toBe("review_required");
    expect(result.failure_reasons).toContain("low_trust_source");
    expect(result.failure_reasons).toContain("high_poisoning_risk");
  });

  test("routes conflict, supersession, and ambiguous matches to review", () => {
    const dir = root();
    appendEvidenceRecord(dir, evidence());
    for (const match_kind of ["potential_conflict", "supersedes_existing", "ambiguous"] as const) {
      const result = verifyCandidate(dir, candidate({ match_kind }));
      expect(result.verification_status).toBe("review_required");
      expect(result.failure_reasons).toContain("match_requires_review");
    }
  });

  test("rejects redacted/deleted evidence", () => {
    const dir = root();
    appendEvidenceRecord(dir, evidence({ redaction_status: "deleted", source_summary: "[deleted]", source_excerpt: undefined }));
    const result = verifyCandidate(dir, candidate());
    expect(result.verification_status).toBe("rejected");
    expect(result.failure_reasons).toContain("redacted_or_deleted_evidence");
  });

  test("rejects tombstone recreation", () => {
    const dir = root();
    appendEvidenceRecord(dir, evidence());
    appendDeletionTombstone(dir, createDeletionTombstone({ deleted_record_id: "mem_1", deletion_mode: "privacy_purge", deletion_reason: "user_requested", now: "2026-05-19T10:00:00.000Z" }));
    const result = verifyCandidate(dir, candidate({ id: "cap_1" }));
    expect(result.verification_status).toBe("rejected");
    expect(result.failure_reasons).toContain("tombstoned_recreation");
  });

  test("legacy candidates without verification metadata remain compatible", () => {
    const dir = root();
    const legacy = { ...candidate(), evidence_ids: undefined, primary_trust_class: undefined, durability_signal: undefined, promotion_eligibility: undefined, poisoning_risk: undefined };
    const result = verifyCandidate(dir, legacy);
    expect(result.verification_status).toBe("legacy_unverified");
    expect(result.requires_human_review).toBe(false);
  });
});
