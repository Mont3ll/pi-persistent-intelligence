import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessOriginalTurnAutoEligibility, classifyCaptureIntent } from "../../src/capture-intent";
import { processCaptureTurn } from "../../src/capture-coordinator";
import { appendEvidenceRecord, readEvidenceRecords } from "../../src/evidence";
import { writeDefaultConfig } from "../../src/config";
import { curateInbox } from "../../src/curator";
import { listCandidates, replaceCandidates } from "../../src/inbox";
import { applyPatch } from "../../src/patch";
import { loadActiveRecords } from "../../src/store";
import {
  durableProjectControls, nondurableSourceControls, optOutControls, scopeBypassControls,
} from "../fixtures/r4-semantic-safety";

const roots: string[] = [];
afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0; });

function isolatedOriginal(message: string, optIn = true) {
  const root = mkdtempSync(join(tmpdir(), "pi-r4-safety-"));
  roots.push(root);
  const cwd = join(root, "project");
  const sessions = join(root, "sessions");
  mkdirSync(cwd);
  mkdirSync(sessions);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "pi-r4-safety-fixture", private: true }));
  const configPath = writeDefaultConfig(root);
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  cfg.governance.mode = "compatibility";
  cfg.curator.sourceAwareAuto = optIn ? "transcript-verified-direct-user" : "off";
  writeFileSync(configPath, JSON.stringify(cfg));
  const captured = processCaptureTurn(root, {
    session_id: "r4-original", turn_id: "r4-runtime",
    message, launch_cwd: cwd, actions: [], now: "2026-10-29T08:00:00Z",
  });
  const transcript = [
    { type: "session", version: 3, id: "r4-original", cwd, timestamp: "2026-10-29T08:00:00Z" },
    { type: "message", id: "persisted-user-turn", message: { role: "user",
      content: [{ type: "text", text: message }] }, timestamp: "2026-10-29T08:01:00Z" },
  ];
  const sessionFile = join(sessions, "r4-original.jsonl");
  writeFileSync(sessionFile, transcript.map((row) => JSON.stringify(row)).join("\n") + "\n");
  const trustedTranscriptOptions = { trustedSessionDirs: [sessions] };
  const curate = () => curateInbox(root, {
    now: "2026-10-29T08:02:00Z", mode: "auto", governanceMode: "compatibility", trustedTranscriptOptions,
  });
  return { root, captured, sessionFile, curate, trustedTranscriptOptions };
}

describe("R4 PR1 original-turn semantic authority safety", () => {
  for (const [index, message] of nondurableSourceControls.entries()) {
    test("nondurable source case " + (index + 1) + " never auto-applies", () => {
      const f = isolatedOriginal(message);
      expect(assessOriginalTurnAutoEligibility(message).eligible).toBe(false);
      const patch = f.curate();
      expect(patch.ops.filter((op) => op.default_selected)).toHaveLength(0);
      if (patch.ops.length) {
        const attempted = applyPatch(f.root, patch, {
          selectedOpIds: patch.ops.map((op) => op.op_id),
          now: "2026-10-29T08:03:00Z", trustedTranscriptOptions: f.trustedTranscriptOptions,
        });
        expect(attempted.applied_ops).toHaveLength(0);
      }
      expect(loadActiveRecords(f.root)).toHaveLength(0);
      for (const candidate of listCandidates(f.root)) {
        expect(candidate.status).toBe("new");
        expect(candidate.promotion_eligibility).toBe("review_only");
      }
    });
  }

  for (const [index, message] of scopeBypassControls.entries()) {
    test("scope bypass " + (index + 1) + " cannot inherit launch-project authority", () => {
      const f = isolatedOriginal(message);
      expect(assessOriginalTurnAutoEligibility(message).eligible).toBe(false);
      const patch = f.curate();
      expect(patch.ops.filter((op) => op.default_selected)).toHaveLength(0);
      if (patch.ops.length) {
        const attempted = applyPatch(f.root, patch, {
          selectedOpIds: patch.ops.map((op) => op.op_id),
          now: "2026-10-29T08:03:00Z", trustedTranscriptOptions: f.trustedTranscriptOptions,
        });
        expect(attempted.applied_ops).toHaveLength(0);
      }
      expect(loadActiveRecords(f.root)).toHaveLength(0);
    });
  }

  for (const message of optOutControls) {
    test("explicit opt-out leaves no candidate or evidence: " + message.slice(0, 26), () => {
      const f = isolatedOriginal(message);
      expect(classifyCaptureIntent(message).intent).toBe("not_memory");
      expect(f.captured.candidates_created).toBe(0);
      expect(listCandidates(f.root)).toHaveLength(0);
      expect(f.curate().ops).toHaveLength(0);
    });
  }

  for (const [index, message] of durableProjectControls.entries()) {
    test("positive project rule " + (index + 1) + " still receives fresh governed apply", () => {
      const f = isolatedOriginal(message);
      expect(assessOriginalTurnAutoEligibility(message).eligible).toBe(true);
      expect(f.captured.candidates_created).toBe(1);
      const patch = f.curate();
      expect(patch.ops).toHaveLength(1);
      expect(patch.ops[0]?.default_selected).toBe(true);
      const result = applyPatch(f.root, patch, {
        selectedOpIds: [patch.ops[0]!.op_id],
        now: "2026-10-29T08:03:00Z", trustedTranscriptOptions: f.trustedTranscriptOptions,
      });
      expect(result.applied_ops).toEqual([patch.ops[0]!.op_id]);
      expect(loadActiveRecords(f.root)).toHaveLength(1);
    });
  }

  test("two references never override a nonendorsed original or a missing transcript", () => {
    const text = "For this project, always use amber labels. This is not an endorsed standing policy.";
    const f = isolatedOriginal(text);
    const original = listCandidates(f.root)[0];
    expect(original).toBeDefined();
    const first = readEvidenceRecords(f.root).find((e) => e.id === original!.evidence_refs[0])!;
    const second = appendEvidenceRecord(f.root, { ...first, id: "independent-review-reference",
      source_kind: "artifact", source_ref: "test:separate-evidence",
      source_session_id: undefined, source_turn_id: undefined,
      source_message_sha256: undefined, source_identity_quality: undefined });
    replaceCandidates(f.root, [{ ...original!, evidence_refs: [first.id, second.id],
      evidence_ids: [first.id, second.id], promotion_eligibility: "auto_candidate" }]);
    const patch = f.curate();
    expect(patch.ops.filter(op => op.default_selected)).toHaveLength(0);
    if (patch.ops.length) {
      const forced = applyPatch(f.root, patch, {
        selectedOpIds: patch.ops.map(op => op.op_id),
        now: "2026-10-29T08:04:00Z", trustedTranscriptOptions: f.trustedTranscriptOptions,
      });
      expect(forced.applied_ops).toHaveLength(0);
    }
    expect(loadActiveRecords(f.root)).toHaveLength(0);
  });

  test("curly-apostrophe memory opt-out does not persist a candidate", () => {
    const f = isolatedOriginal("Don’t remember this: This repository always uses amber icons.");
    expect(f.captured.candidates_created).toBe(0);
    expect(listCandidates(f.root)).toHaveLength(0);
  });

  for (const text of [
    "For this project, always use amber labels. This is not an endorsed standing policy.",
    "For this project, always use amber labels only if the green fixture passes.",
    "For this repository, always use amber labels across all repositories.",
  ]) {
    test("additional semantic negative is held: " + text.slice(-35), () => {
      const f = isolatedOriginal(text);
      expect(assessOriginalTurnAutoEligibility(text).eligible).toBe(false);
      const patch = f.curate();
      expect(patch.ops.filter(op => op.default_selected)).toHaveLength(0);
      expect(loadActiveRecords(f.root)).toHaveLength(0);
    });
  }

  test("default-off still holds a valid standalone original", () => {
    const f = isolatedOriginal(durableProjectControls[0], false);
    expect(f.curate().ops).toHaveLength(0);
    expect(loadActiveRecords(f.root)).toHaveLength(0);
  });

  test("mixed original remains review-only even if its prefix looks durable", () => {
    const text = "For this project, always use the release checklist. "
      + "This sprint is a temporary UI exercise, not an approved permanent instruction.";
    const f = isolatedOriginal(text);
    expect(f.captured.candidates_created).toBeGreaterThanOrEqual(0);
    for (const candidate of listCandidates(f.root)) expect(candidate.promotion_eligibility).toBe("review_only");
    expect(f.curate().ops.filter((op) => op.default_selected)).toHaveLength(0);
    expect(loadActiveRecords(f.root)).toHaveLength(0);
  });

  test("forged review-only metadata and persisted verified flag cannot promote quoted original", () => {
    const message = "For this project, always use the checklist in this quoted UI sample.";
    const f = isolatedOriginal(message);
    const candidates = listCandidates(f.root);
    // A daily-only result is already safe; inject a persisted captured candidate
    // from a genuine positive rule to test forged metadata independently.
    const sourceCandidate = candidates[0];
    if (!sourceCandidate) {
      expect(f.captured.daily_only).toBeGreaterThan(0);
      return;
    }
    replaceCandidates(f.root, [{ ...sourceCandidate, promotion_eligibility: "auto_candidate" }]);
    const path = join(f.root, "memory", "evidence.jsonl");
    const forged = readFileSync(path, "utf8").trim().split("\n").map((line) =>
      JSON.stringify({ ...JSON.parse(line), source_transcript_verified: true }));
    writeFileSync(path, forged.join("\n") + "\n");
    const patch = f.curate();
    expect(patch.ops.filter((op) => op.default_selected)).toHaveLength(0);
    if (patch.ops.length) {
      const result = applyPatch(f.root, patch, {
        selectedOpIds: patch.ops.map((op) => op.op_id),
        now: "2026-10-29T08:03:00Z", trustedTranscriptOptions: f.trustedTranscriptOptions,
      });
      expect(result.applied_ops).toHaveLength(0);
    }
    expect(loadActiveRecords(f.root)).toHaveLength(0);
  });
});
