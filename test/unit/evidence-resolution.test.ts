import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEvidenceReference } from "../../src/evidence-resolution";
import type { EvidenceRecord } from "../../src/types";

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-evidence-resolution-"));
  mkdirSync(join(dir, "daily"), { recursive: true });
  return dir;
}

const base = {
  memoryId: "mem_1",
  resourceId: "resource",
  profileId: "profile",
  createdAt: "2026-08-20T00:00:00Z",
  scopeLevel: "global",
};

describe("evidence resolution", () => {
  test("reuses an existing valid structured evidence record", () => {
    const existing: EvidenceRecord = { id: "ev_existing", resource_id: "r", profile_id: "p", created_at: "n", source_kind: "conversation", source_summary: "verified", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_1"], redaction_status: "none" };
    expect(resolveEvidenceReference({ root: root(), reference: existing.id, existingEvidence: [existing], ...base })).toEqual({ status: "alreadyStructured", evidenceId: existing.id });
  });

  test("resolves a verified in-store daily source deterministically", () => {
    const dir = root();
    writeFileSync(join(dir, "daily/2026-08-20.md"), "Use bun test for this project.\n");
    const input = { root: dir, reference: "daily/2026-08-20.md", existingEvidence: [], ...base };
    const first = resolveEvidenceReference(input);
    const second = resolveEvidenceReference(input);
    expect(first).toEqual(second);
    expect(first.status).toBe("resolved");
    if (first.status === "resolved") expect(first.evidence).toMatchObject({ source_ref: input.reference, trust_class: "unknown", notes: "legacy_evidence_backfill_v2" });
  });

  test("resolves a capture-backed session reference without inventing source text", () => {
    const result = resolveEvidenceReference({ root: root(), reference: "session:s1:turn:t1", existingEvidence: [], candidateText: "Avoid promotional language.", candidateTrustClass: "direct_user_instruction", ...base });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.evidence).toMatchObject({ source_session_id: "s1", source_ref: "session:s1:turn:t1", source_summary: "Avoid promotional language.", trust_class: "direct_user_instruction" });
  });

  test("does not fabricate unsupported, missing, redacted, or secret-bearing evidence", () => {
    const dir = root();
    writeFileSync(join(dir, "daily/secret.md"), "token=ghp_abcdefghijklmnopqrstuvwxyz1234567890");
    const redacted: EvidenceRecord = { id: "ev_redacted", resource_id: "r", profile_id: "p", created_at: "n", source_kind: "conversation", source_summary: "[redacted]", trust_class: "unknown", polarity: "supports", related_memory_ids: [], redaction_status: "redacted" };
    expect(resolveEvidenceReference({ root: dir, reference: "missing.md", existingEvidence: [], ...base })).toMatchObject({ status: "unresolved", reason: "sourceMissing" });
    expect(resolveEvidenceReference({ root: dir, reference: "external:unknown", existingEvidence: [], ...base })).toMatchObject({ status: "unresolved", reason: "unsupportedReference" });
    expect(resolveEvidenceReference({ root: dir, reference: redacted.id, existingEvidence: [redacted], ...base })).toMatchObject({ status: "unresolved", reason: "sourceRedacted" });
    expect(resolveEvidenceReference({ root: dir, reference: "daily/secret.md", existingEvidence: [], ...base })).toMatchObject({ status: "unresolved", reason: "secretDetected" });
  });
});
