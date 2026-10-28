import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CAPTURE_POLICY_VERSION,
  resolveCaptureSessionIdentity,
} from "../../src/capture-provenance";
import { processCaptureTurn } from "../../src/capture-coordinator";
import { listCandidates } from "../../src/inbox";
import { readEvidenceRecords } from "../../src/evidence";

const roots: string[] = [];
afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0; });

describe("versioned capture source contract", () => {
  test("event identity wins when present, then host session manager", () => {
    expect(resolveCaptureSessionIdentity({ session_id: "source-s1" }, {
      sessionManager: { getSessionId: () => "source-s2" },
    })).toEqual({ session_id: "source-s1", identity_quality: "stable_session_id" });
    expect(resolveCaptureSessionIdentity({}, {
      sessionManager: { getSessionId: () => "source-s2" },
    })).toEqual({ session_id: "source-s2", identity_quality: "stable_session_id" });
  });

  test("missing identity is explicitly unresolved, never invented", () => {
    expect(resolveCaptureSessionIdentity({}, undefined)).toEqual({
      session_id: "current-session", identity_quality: "unresolved",
    });
    expect(resolveCaptureSessionIdentity({ session_id: "current-session" }, {
      sessionManager: { getSessionId: () => { throw new Error("unavailable"); } },
    }).identity_quality).toBe("unresolved");
  });

  test("full original turn hash and capture policy survive the 300-character display excerpt", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-capture-source-")); roots.push(root);
    const message = "For this project, always use the accepted mintquartz verification procedure. "
      + "The procedure is confirmed for project-level release review. ".repeat(12);
    expect(message.length).toBeGreaterThan(300);
    const result = processCaptureTurn(root, {
      session_id: "actual-session-id", turn_id: "turn-42",
      message, launch_cwd: "/projects/pi", actions: [],
      now: "2026-10-28T08:00:00Z",
    });
    expect(result.candidates_created).toBe(1);
    const candidate = listCandidates(root)[0]!;
    const evidence = readEvidenceRecords(root)[0]!;
    const hash = createHash("sha256").update(message.trim()).digest("hex");
    expect(candidate.text.length).toBeLessThanOrEqual(300);
    expect(candidate.capture_source).toMatchObject({
      version: 1,
      policy_version: CAPTURE_POLICY_VERSION,
      session_id: "actual-session-id",
      turn_id: "turn-42",
      identity_quality: "stable_session_id",
      original_message_sha256: hash,
      original_character_count: message.trim().length,
      persisted_excerpt_character_count: candidate.text.length,
    });
    expect(evidence).toMatchObject({
      source_session_id: "actual-session-id",
      source_turn_id: "turn-42",
      source_message_sha256: hash,
      source_identity_quality: "stable_session_id",
      source_ref: "session:actual-session-id:turn:turn-42",
    });
    expect(candidate.source_turn_ids).toContain("actual-session-id:turn-42");
  });

  test("an unresolved source is labelled as such in both candidate and evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-capture-unresolved-")); roots.push(root);
    const result = processCaptureTurn(root, {
      session_id: "current-session", turn_id: "turn-7",
      message: "For this project, always use the accepted validation checklist.",
      launch_cwd: "/projects/pi", actions: [], now: "2026-10-28T08:01:00Z",
    });
    expect(result.candidates_created).toBe(1);
    expect(listCandidates(root)[0]?.capture_source?.identity_quality).toBe("unresolved");
    expect(readEvidenceRecords(root)[0]?.source_identity_quality).toBe("unresolved");
  });
});
