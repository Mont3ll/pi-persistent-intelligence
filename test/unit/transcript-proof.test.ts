import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCaptureSourceAttribution } from "../../src/capture-provenance";
import { resolveProjectIdentity } from "../../src/profile";
import { createTranscriptDiscoveryIndex, verifyCandidateTranscriptSource } from "../../src/transcript-proof";
import type { CaptureCandidate, EvidenceRecord } from "../../src/types";

const dirs: string[] = [];
afterEach(() => {
  for (const root of dirs) rmSync(root, { recursive: true, force: true });
  dirs.length = 0;
});
const directMessage = "For this project, always use the trusted saffronquartz release checklist."
  + " This convention remains in force for the project.".repeat(7);

function fixture(role = "user", message = directMessage) {
  const root = mkdtempSync(join(tmpdir(), "pi-transcript-proof-"));
  dirs.push(root);
  const project = join(root, "source-project");
  const sessionDir = join(root, "trusted-sessions");
  mkdirSync(project);
  mkdirSync(sessionDir);
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "pi-proof-fixture", private: true }));
  const projectId = resolveProjectIdentity(project).project_id;
  const sessionId = "recorded-session-001";
  const runtimeTurnId = "runtime-turn-id";
  const entryId = "jsonl-user-entry-001";
  const excerpt = message.trim().slice(0, 300).replace(/\s+/g, " ");
  const source = buildCaptureSourceAttribution(sessionId, runtimeTurnId, message, excerpt);
  const sourceRef = "session:" + sessionId + ":turn:" + runtimeTurnId;
  const evidence: EvidenceRecord = {
    id: "evidence_original", resource_id: "curation", profile_id: "legacy-default",
    created_at: "2026-10-28T08:00:00Z",
    source_kind: "conversation", source_session_id: sessionId,
    source_turn_id: runtimeTurnId, source_ref: sourceRef,
    source_summary: excerpt, source_message_sha256: source.original_message_sha256,
    source_identity_quality: "observed_session_id",
    source_transcript_verified: false,
    trust_class: "direct_user_instruction", polarity: "supports",
    redaction_status: "none", related_memory_ids: [], notes: "capture_evidence_v1",
  };
  const candidate: CaptureCandidate = {
    id: "cap_saffron", created_at: "2026-10-28T08:00:00Z",
    source: { type: "direct_user_instruction", ref: sourceRef },
    text: excerpt, capture_source: source,
    tags: ["capture", "project_convention"],
    confidence: 0.92, status: "new",
    evidence_refs: [evidence.id], evidence_ids: [evidence.id],
    scope_targets: [{ type: "project", project: projectId, confidence: 0.95, basis: ["fixture"] }],
  };
  const transcript = join(sessionDir, "session.jsonl");
  const header = { type: "session", version: 3, id: sessionId, timestamp: "2026-10-28T08:00:00Z", cwd: project };
  function entry(content: string, currentRole: string, id = entryId) {
    return { type: "message", id, timestamp: "2026-10-28T08:00:01Z",
      message: { role: currentRole, content: [{ type: "text", text: content }] } };
  }
  function write(entries: unknown[]) {
    writeFileSync(transcript, [header, ...entries].map(x => JSON.stringify(x)).join("\n") + "\n");
  }
  write([entry(message, role)]);
  return { root, project, sessionDir, candidate, evidence, transcript, header, entry, write };
}

describe("trusted original Pi session transcript proof", () => {
  test("proves unique full user turn rather than truncated excerpt", () => {
    const f = fixture();
    expect(f.candidate.text.length).toBe(300);
    const result = verifyCandidateTranscriptSource(f.candidate, f.evidence, { trustedSessionDirs: [f.sessionDir] });
    expect(result).toMatchObject({
      verified: true, reason: "verified", method: "unique_user_message_hash",
      matched_session_id: "recorded-session-001",
      matched_user_turn_id: "jsonl-user-entry-001",
      source_hash: f.candidate.capture_source!.original_message_sha256,
    });
    expect(JSON.stringify(result)).not.toContain(f.project);
    expect(JSON.stringify(result)).not.toContain("saffronquartz");
  });
  test("forged verified=true cannot prove a nonexistent source", () => {
    const f = fixture();
    rmSync(f.transcript);
    expect(verifyCandidateTranscriptSource(f.candidate,
      { ...f.evidence, source_transcript_verified: true },
      { trustedSessionDirs: [f.sessionDir] })).toEqual({ verified: false, reason: "no_trusted_session_file" });
  });
  test("matching assistant content is not user-authored evidence", () => {
    const f = fixture("assistant");
    expect(verifyCandidateTranscriptSource(f.candidate, f.evidence,
      { trustedSessionDirs: [f.sessionDir] }).reason).toBe("user_turn_missing");
  });
  test("duplicate identical user turns are ambiguous", () => {
    const f = fixture();
    f.write([f.entry(directMessage, "user", "first"), f.entry(directMessage, "user", "second")]);
    expect(verifyCandidateTranscriptSource(f.candidate, f.evidence,
      { trustedSessionDirs: [f.sessionDir] }).reason).toBe("ambiguous_user_turn");
  });
  test("duplicate files claiming the same session are held", () => {
    const f = fixture();
    writeFileSync(join(f.sessionDir, "duplicate.jsonl"), readFileSync(f.transcript));
    expect(verifyCandidateTranscriptSource(f.candidate, f.evidence,
      { trustedSessionDirs: [f.sessionDir] }).reason).toBe("ambiguous_session_files");
  });
  test("mismatched original hash or changed excerpt is held", () => {
    const f = fixture();
    expect(verifyCandidateTranscriptSource({
      ...f.candidate,
      capture_source: { ...f.candidate.capture_source!, original_message_sha256: "a".repeat(64) },
    }, { ...f.evidence, source_message_sha256: "a".repeat(64) },
    { trustedSessionDirs: [f.sessionDir] }).reason).toBe("user_turn_missing");
    expect(verifyCandidateTranscriptSource({
      ...f.candidate, text: "Different asserted convention.",
    }, f.evidence, { trustedSessionDirs: [f.sessionDir] }).reason).toBe("invalid_source_evidence");
  });
  test("scope must independently resolve from original session cwd", () => {
    const f = fixture();
    expect(verifyCandidateTranscriptSource({
      ...f.candidate,
      scope_targets: [{ type: "project", project: "foreign-project", confidence: 0.95, basis: ["false"] }],
    }, f.evidence, { trustedSessionDirs: [f.sessionDir] }).reason).toBe("scope_mismatch");
  });
  test("legacy and unresolved provenance is never upgraded", () => {
    const f = fixture();
    expect(verifyCandidateTranscriptSource({
      ...f.candidate, capture_source: undefined,
    }, f.evidence, { trustedSessionDirs: [f.sessionDir] }).verified).toBe(false);
    expect(verifyCandidateTranscriptSource({
      ...f.candidate, capture_source: { ...f.candidate.capture_source!, identity_quality: "unresolved" },
    }, f.evidence, { trustedSessionDirs: [f.sessionDir] }).verified).toBe(false);
  });
  test("invalidated, inferred, or foreign-resource evidence cannot qualify", () => {
    const f = fixture();
    for (const fields of [
      { redaction_status: "deleted" as const },
      { redaction_status: "redacted" as const },
      { resource_id: "foreign-resource" },
      { trust_class: "agent_inference" as const },
      { polarity: "contradicts" as const },
    ]) {
      expect(verifyCandidateTranscriptSource(f.candidate,
        { ...f.evidence, ...fields }, { trustedSessionDirs: [f.sessionDir] }).verified).toBe(false);
    }
  });
  test("symlink to outside trusted root cannot supply proof", () => {
    const f = fixture();
    const outside = join(f.root, "outside.jsonl");
    writeFileSync(outside, readFileSync(f.transcript));
    rmSync(f.transcript);
    symlinkSync(outside, f.transcript);
    expect(verifyCandidateTranscriptSource(f.candidate, f.evidence,
      { trustedSessionDirs: [f.sessionDir] }).reason).toBe("no_trusted_session_file");
  });
  test("one operation index supports repeated proof while each source is reread", () => {
    const f = fixture();
    const options = { trustedSessionDirs: [f.sessionDir] };
    const discoveryIndex = createTranscriptDiscoveryIndex(options);
    expect(discoveryIndex.scannedFiles).toBe(1);
    expect(discoveryIndex.bySessionId.get("recorded-session-001")?.length).toBe(1);
    for (let i = 0; i < 8; i++) {
      expect(verifyCandidateTranscriptSource(f.candidate, f.evidence, {
        ...options, discoveryIndex,
      }).verified).toBe(true);
    }
    // The index cannot become a replacement for the original source.
    f.write([f.entry("For this project, always use a DIFFERENT release checklist.", "user")]);
    expect(verifyCandidateTranscriptSource(f.candidate, f.evidence, {
      ...options, discoveryIndex,
    }).reason).toBe("user_turn_missing");
    rmSync(f.transcript);
    expect(verifyCandidateTranscriptSource(f.candidate, f.evidence, {
      ...options, discoveryIndex,
    }).verified).toBe(false);
  });

  test("new transcript becomes available on a later discovery attempt", () => {
    const f = fixture();
    rmSync(f.transcript);
    const options = { trustedSessionDirs: [f.sessionDir] };
    const before = createTranscriptDiscoveryIndex(options);
    expect(verifyCandidateTranscriptSource(f.candidate, f.evidence, {
      ...options, discoveryIndex: before,
    }).reason).toBe("no_trusted_session_file");
    f.write([f.entry(directMessage, "user")]);
    const after = createTranscriptDiscoveryIndex(options);
    expect(verifyCandidateTranscriptSource(f.candidate, f.evidence, {
      ...options, discoveryIndex: after,
    }).verified).toBe(true);
  });

  test("a supplied discovery hint cannot point outside the trusted roots", () => {
    const f = fixture();
    const unrelated = join(f.root, "outside.jsonl");
    writeFileSync(unrelated, readFileSync(f.transcript));
    const forged = { scannedFiles: 1, bySessionId: new Map([
      ["recorded-session-001", [unrelated]],
    ]) };
    expect(verifyCandidateTranscriptSource(f.candidate, f.evidence, {
      trustedSessionDirs: [f.sessionDir], discoveryIndex: forged,
    }).verified).toBe(false);
  });

  test("replacement with symlink after discovery is held", () => {
    const f = fixture();
    const options = { trustedSessionDirs: [f.sessionDir] };
    const discoveryIndex = createTranscriptDiscoveryIndex(options);
    const elsewhere = join(f.root, "outside.jsonl");
    writeFileSync(elsewhere, readFileSync(f.transcript));
    rmSync(f.transcript);
    symlinkSync(elsewhere, f.transcript);
    expect(verifyCandidateTranscriptSource(f.candidate, f.evidence, {
      ...options, discoveryIndex,
    }).verified).toBe(false);
  });

  test("malformed or incorrect session headers are held", () => {
    const f = fixture();
    writeFileSync(f.transcript, '{"type":"session"');
    expect(verifyCandidateTranscriptSource(f.candidate, f.evidence,
      { trustedSessionDirs: [f.sessionDir] }).verified).toBe(false);
    f.write([f.entry(directMessage, "user")]);
    writeFileSync(f.transcript, readFileSync(f.transcript, "utf8")
      .replace("recorded-session-001", "other-session"));
    expect(verifyCandidateTranscriptSource(f.candidate, f.evidence,
      { trustedSessionDirs: [f.sessionDir] }).verified).toBe(false);
  });
});
