import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessOriginalTurnAutoEligibility, classifyCaptureIntent } from "../../src/capture-intent";
import { processCaptureTurn } from "../../src/capture-coordinator";
import { buildCaptureSourceAttribution } from "../../src/capture-provenance";
import { verifyCandidateTranscriptSource } from "../../src/transcript-proof";
import { scoreMemoryWorth } from "../../src/memory-worth";
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
  return { root, captured, sessionFile, configPath, curate, trustedTranscriptOptions };
}

/**
 * Make a real candidate eligible for a curator proposal through the normal
 * two-reference floor. The second reference is *not* original user authority:
 * it only makes the held operation reachable by a governed attempt.
 */
function atEvidenceFloor(f: ReturnType<typeof isolatedOriginal>): void {
  const candidate = listCandidates(f.root)[0];
  expect(candidate).toBeDefined();
  if (!candidate) throw new Error("Expected a persisted capture candidate");
  const first = readEvidenceRecords(f.root).find(e => e.id === candidate.evidence_refs[0]);
  expect(first).toBeDefined();
  if (!first) throw new Error("Expected captured source evidence");
  const second = appendEvidenceRecord(f.root, {
    ...first, id: "r4-independent-test-reference", source_kind: "test_result",
    source_ref: "test:corroborating-reference", source_session_id: undefined,
    source_turn_id: undefined, source_message_sha256: undefined,
    source_identity_quality: undefined, source_transcript_verified: undefined,
  });
  replaceCandidates(f.root, [{
    ...candidate, evidence_refs: [first.id, second.id],
    evidence_ids: [first.id, second.id],
  }]);
}

/**
 * Simulate an earlier source-captured candidate that was persisted before the
 * task-only classification correction. Its original transcript remains real,
 * authenticated and semantically task-only; the legacy metadata is positive.
 */
function earlierPersistedTaskOnlyOriginal(message: string) {
  const f = isolatedOriginal(durableProjectControls[0]);
  const original = listCandidates(f.root)[0];
  expect(original).toBeDefined();
  if (!original) throw new Error("Expected a persisted source fixture");
  const excerpt = message.trim().slice(0, 300).replace(/\s+/g, " ");
  const source = buildCaptureSourceAttribution("r4-original", "r4-runtime", message, excerpt);
  replaceCandidates(f.root, [{
    ...original, text: excerpt, capture_source: source,
    capture_intent: "project_convention", worth_decision: "candidate",
    promotion_eligibility: "auto_candidate",
  }]);
  const evidencePath = join(f.root, "memory", "evidence.jsonl");
  const evidenceRows = readEvidenceRecords(f.root).map(row => ({
    ...row, source_summary: excerpt,
    source_message_sha256: source.original_message_sha256,
  }));
  writeFileSync(evidencePath, evidenceRows.map(row => JSON.stringify(row)).join("\n") + "\n");
  const transcript = readFileSync(f.sessionFile, "utf8").trim().split("\n").map(row => JSON.parse(row));
  const user = transcript.find(row => row.type === "message" && row.message?.role === "user");
  if (!user) throw new Error("Missing fixture user turn");
  user.message.content = [{ type: "text", text: message }];
  writeFileSync(f.sessionFile, transcript.map(row => JSON.stringify(row)).join("\n") + "\n");
  return f;
}

describe("R4 PR1 original-turn semantic authority safety", () => {
  for (const [index, message] of nondurableSourceControls.entries()) {
    test("nondurable source case " + (index + 1) + " never auto-applies", () => {
      const f = isolatedOriginal(message);
      expect(assessOriginalTurnAutoEligibility(message).eligible).toBe(false);
      if (listCandidates(f.root).length) atEvidenceFloor(f);
      const patch = f.curate();
      expect(patch.ops.filter((op) => op.default_selected)).toHaveLength(0);
      if (listCandidates(f.root).length) expect(patch.ops.length).toBeGreaterThan(0);
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
      if (listCandidates(f.root).length) atEvidenceFloor(f);
      const patch = f.curate();
      expect(patch.ops.filter((op) => op.default_selected)).toHaveLength(0);
      if (listCandidates(f.root).length) expect(patch.ops.length).toBeGreaterThan(0);
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

  test("two references never override a nonendorsed original", () => {
    const text = "For this project, always use amber labels. This is not an endorsed standing policy.";
    const f = isolatedOriginal(text);
    const original = listCandidates(f.root)[0];
    expect(original).toBeDefined();
    const first = readEvidenceRecords(f.root).find((e) => e.id === original!.evidence_refs[0])!;
    const second = appendEvidenceRecord(f.root, { ...first, id: "independent-review-reference",
      source_kind: "test_result", source_ref: "test:separate-evidence",
      source_session_id: undefined, source_turn_id: undefined,
      source_message_sha256: undefined, source_identity_quality: undefined });
    replaceCandidates(f.root, [{ ...original!, evidence_refs: [first.id, second.id],
      evidence_ids: [first.id, second.id], promotion_eligibility: "auto_candidate" }]);
    const patch = f.curate();
    expect(patch.ops).toHaveLength(1);
    expect(patch.ops.filter(op => op.default_selected)).toHaveLength(0);
    const forced = applyPatch(f.root, patch, {
      selectedOpIds: patch.ops.map(op => op.op_id),
      now: "2026-10-29T08:04:00Z", trustedTranscriptOptions: f.trustedTranscriptOptions,
    });
    expect(forced.applied_ops).toHaveLength(0);
    expect(forced.skipped_ops.some(op => op.reason === "capture_policy_hold")).toBe(true);
    expect(loadActiveRecords(f.root)).toHaveLength(0);
  });

  for (const [label, message] of [
    ["ascii-single-quoted panel", "A panel says 'For this project, always use the sapphire release manifest before publishing.'"],
    ["initial if condition", "If the archive is enabled, for this project always use sapphire manifests."],
  ] as const) {
    for (const referencesAtApply of [1, 2] as const) {
      test(label + " is held at apply with " + referencesAtApply + " reference(s)", () => {
        const f = isolatedOriginal(message);
        expect(f.captured.candidates_created).toBe(1);
        expect(listCandidates(f.root)).toHaveLength(1);
        expect(assessOriginalTurnAutoEligibility(message).eligible).toBe(false);
        expect(listCandidates(f.root)[0]?.promotion_eligibility).toBe("review_only");

        // Deliberately reach the normal two-reference proposal floor. This
        // supplies a real operation, even though its auto-selection is held.
        atEvidenceFloor(f);
        const patch = f.curate();
        expect(patch.ops.length).toBe(1);
        expect(patch.ops[0]?.default_selected).toBe(false);

        if (referencesAtApply === 1) {
          // Replay the same proposal after the second evidence link is lost.
          // Apply-time authorization must reject both reference counts.
          const candidate = listCandidates(f.root)[0]!;
          replaceCandidates(f.root, [{
            ...candidate,
            evidence_refs: candidate.evidence_refs.slice(0, 1),
            evidence_ids: candidate.evidence_ids?.slice(0, 1),
          }]);
        }
        const result = applyPatch(f.root, patch, {
          selectedOpIds: patch.ops.map(op => op.op_id),
          now: "2026-10-29T09:10:00Z",
          trustedTranscriptOptions: f.trustedTranscriptOptions,
        });
        expect(result.applied_ops).toHaveLength(0);
        expect(result.skipped_ops.some(op => op.reason === "capture_policy_hold")).toBe(true);
        expect(loadActiveRecords(f.root)).toHaveLength(0);
      });
    }
  }

  test("project-prefixed report is context rather than user-endorsed authority", () => {
    const text = "For this project, the panel says always run the sapphire release audit.";
    expect(assessOriginalTurnAutoEligibility(text)).toEqual({
      eligible: false, reason: "project_context_without_direct_endorsement",
    });
  });

  for (const referenceCount of [1, 2] as const) {
    test("project-prefixed indirect panel report cannot apply at " + referenceCount + " reference(s)", () => {
      const text = "For this project, the panel says always run the sapphire release audit.";
      const f = isolatedOriginal(text);
      expect(f.captured.candidates_created).toBe(1);
      const candidates = listCandidates(f.root);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.promotion_eligibility).toBe("review_only");
      atEvidenceFloor(f);
      const patch = f.curate();
      expect(patch.ops).toHaveLength(1);
      expect(patch.ops[0]?.default_selected).toBe(false);
      if (referenceCount === 1) {
        const persisted = listCandidates(f.root)[0]!;
        replaceCandidates(f.root, [{
          ...persisted,
          evidence_refs: persisted.evidence_refs.slice(0, 1),
          evidence_ids: persisted.evidence_ids?.slice(0, 1),
        }]);
      }
      const result = applyPatch(f.root, patch, {
        selectedOpIds: patch.ops.map(op => op.op_id),
        now: "2026-10-29T19:00:00Z",
        trustedTranscriptOptions: f.trustedTranscriptOptions,
      });
      expect(result.applied_ops).toHaveLength(0);
      expect(result.skipped_ops.some(op => op.reason === "capture_policy_hold")).toBe(true);
      expect(loadActiveRecords(f.root)).toHaveLength(0);
    });

    test("curly contraction preserves an endorsed project rule at " + referenceCount + " reference(s)", () => {
      const message = "For this project, never use stale manifests; they’re unreliable.";
      expect(assessOriginalTurnAutoEligibility(message)).toEqual({
        eligible: true, reason: "explicit_original_project_rule",
      });
      const f = isolatedOriginal(message);
      expect(f.captured.candidates_created).toBe(1);
      expect(listCandidates(f.root)).toHaveLength(1);
      expect(listCandidates(f.root)[0]?.promotion_eligibility).toBe("auto_candidate");
      if (referenceCount === 2) atEvidenceFloor(f);
      const patch = f.curate();
      expect(patch.ops).toHaveLength(1);
      expect(patch.ops[0]?.default_selected).toBe(true);
      const result = applyPatch(f.root, patch, {
        selectedOpIds: [patch.ops[0]!.op_id],
        now: "2026-10-29T19:01:00Z",
        trustedTranscriptOptions: f.trustedTranscriptOptions,
      });
      expect(result.applied_ops).toEqual([patch.ops[0]!.op_id]);
      expect(loadActiveRecords(f.root)).toHaveLength(1);
    });
  }

  test("ASCII contractions remain eligible and typographic quotes remain held", () => {
    const ascii = "For this project, never use stale manifests; they're unreliable.";
    expect(assessOriginalTurnAutoEligibility(ascii).eligible).toBe(true);
    const curlyQuote = "For this project, always use the label ‘run the sapphire audit’.";
    expect(assessOriginalTurnAutoEligibility(curlyQuote).eligible).toBe(false);
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
    "For this repository, always use amber labels across our repositories.",
    "For this project, always use amber labels provided that a review signs off.",
    "For this project, always use amber labels. This is a draft, not a decision.",
    "A settings panel says for this project always use sapphire release labels.",
    "For this project, always use amber labels. The next sentence describes a test panel.",
  ]) {
    test("additional semantic negative is held: " + text.slice(-35), () => {
      const f = isolatedOriginal(text);
      if (text.includes("provided that") || text.includes("across our repositories") || text.includes("a draft, not a decision")) {
        expect(f.captured.candidates_created).toBe(1);
        expect(listCandidates(f.root)).toHaveLength(1);
      }
      expect(assessOriginalTurnAutoEligibility(text).eligible).toBe(false);
      const candidateCount = listCandidates(f.root).length;
      if (candidateCount) atEvidenceFloor(f);
      const patch = f.curate();
      expect(patch.ops.filter(op => op.default_selected)).toHaveLength(0);
      if (candidateCount) expect(patch.ops.length).toBeGreaterThan(0);
      if (patch.ops.length) {
        const forced = applyPatch(f.root, patch, {
          selectedOpIds: patch.ops.map(op => op.op_id),
          now: "2026-10-29T08:08:00Z", trustedTranscriptOptions: f.trustedTranscriptOptions,
        });
        expect(forced.applied_ops).toHaveLength(0);
        expect(forced.skipped_ops.some(op => op.reason === "capture_policy_hold")).toBe(true);
      }
      expect(loadActiveRecords(f.root)).toHaveLength(0);
    });
  }

  test("balanced ASCII quotes inside an otherwise direct rule remain review-only", () => {
    const quoted = "For this project, always use the panel label 'keep this exact line'.";
    expect(assessOriginalTurnAutoEligibility(quoted).eligible).toBe(false);
  });

  test("an apostrophe in a genuine correction is not a quoted panel", () => {
    const correction = "For this project, don't use stale release manifests.";
    expect(assessOriginalTurnAutoEligibility(correction).eligible).toBe(true);
  });

  test("default-off still holds a valid standalone original", () => {
    const f = isolatedOriginal(durableProjectControls[0], false);
    expect(f.curate().ops).toHaveLength(0);
    expect(loadActiveRecords(f.root)).toHaveLength(0);
  });

  test("mixed original remains review-only even if its prefix looks durable", () => {
    const text = "For this project, always use the release checklist. "
      + "This sprint is a temporary UI exercise, not an approved permanent instruction.";
    const f = isolatedOriginal(text);
    expect(assessOriginalTurnAutoEligibility(text).eligible).toBe(false);
    const candidates = listCandidates(f.root);
    if (candidates.length === 0) {
      // Capture rejected the task-bound turn before curation: assert the
      // durable inbox is actually empty, not merely an empty patch.
      expect(f.captured.daily_only + f.captured.rejected).toBeGreaterThan(0);
      expect(f.curate().ops).toHaveLength(0);
    } else {
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.promotion_eligibility).toBe("review_only");
      atEvidenceFloor(f);
      const patch = f.curate();
      expect(patch.ops.length).toBeGreaterThan(0);
      expect(patch.ops.filter(op => op.default_selected)).toHaveLength(0);
      const attempted = applyPatch(f.root, patch, {
        selectedOpIds: patch.ops.map(op => op.op_id),
        now: "2026-10-29T09:11:00Z",
        trustedTranscriptOptions: f.trustedTranscriptOptions,
      });
      expect(attempted.applied_ops).toHaveLength(0);
    }
    expect(loadActiveRecords(f.root)).toHaveLength(0);
  });

  test("forged metadata and stored verified flag cannot promote a real unendorsed candidate", () => {
    const message = "For this project, always use amber headings. This wording is a quotation, not an approved decision.";
    const f = isolatedOriginal(message);
    const candidates = listCandidates(f.root);
    expect(f.captured.candidates_created).toBe(1);
    expect(candidates).toHaveLength(1);
    replaceCandidates(f.root, [{ ...candidates[0]!, promotion_eligibility: "auto_candidate" }]);
    atEvidenceFloor(f);
    const path = join(f.root, "memory", "evidence.jsonl");
    const forged = readFileSync(path, "utf8").trim().split("\n").map((line) =>
      JSON.stringify({ ...JSON.parse(line), source_transcript_verified: true }));
    writeFileSync(path, forged.join("\n") + "\n");
    const patch = f.curate();
    expect(patch.ops.filter((op) => op.default_selected)).toHaveLength(0);
    expect(patch.ops.length).toBeGreaterThan(0);
    expect(patch.ops.every(op => op.default_selected === false)).toBe(true);
    const result = applyPatch(f.root, patch, {
      selectedOpIds: patch.ops.map((op) => op.op_id),
      now: "2026-10-29T08:03:00Z", trustedTranscriptOptions: f.trustedTranscriptOptions,
    });
    expect(result.applied_ops).toHaveLength(0);
    expect(result.skipped_ops.some((op) => op.reason === "capture_policy_hold")).toBe(true);
    expect(loadActiveRecords(f.root)).toHaveLength(0);
  });

  test("removing capture source and intent cannot auto-promote an unendorsed captured turn", () => {
    const f = isolatedOriginal("For this project, always use amber headings. This is only a draft.");
    const original = listCandidates(f.root)[0];
    expect(original).toBeDefined();
    const first = readEvidenceRecords(f.root).find(e => e.id === original!.evidence_refs[0])!;
    const second = appendEvidenceRecord(f.root, { ...first, id: "r4-forged-second-reference",
      source_kind: "test_result", source_ref: "test:second-reference",
      source_session_id: undefined, source_turn_id: undefined,
      source_message_sha256: undefined, source_identity_quality: undefined });
    replaceCandidates(f.root, [{ ...original!, capture_source: undefined, capture_intent: undefined,
      evidence_refs: [first.id, second.id], evidence_ids: [first.id, second.id],
      promotion_eligibility: "auto_candidate" }]);
    const patch = f.curate();
    expect(patch.ops.length).toBeGreaterThan(0);
    expect(patch.ops.filter(op => op.default_selected)).toHaveLength(0);
    const result = applyPatch(f.root, patch, {
      selectedOpIds: patch.ops.map(op => op.op_id),
      now: "2026-10-29T08:04:00Z", trustedTranscriptOptions: f.trustedTranscriptOptions,
    });
    expect(result.applied_ops).toHaveLength(0);
    expect(result.skipped_ops.some(op => op.reason === "capture_policy_hold")).toBe(true);
    expect(loadActiveRecords(f.root)).toHaveLength(0);
  });

  test("missing transcript at the reference floor rejects a previously selected proposal", () => {
    const f = isolatedOriginal(durableProjectControls[0]);
    const original = listCandidates(f.root)[0]!;
    const first = readEvidenceRecords(f.root).find(e => e.id === original.evidence_refs[0])!;
    const second = appendEvidenceRecord(f.root, { ...first, id: "r4-source-loss-second-reference",
      source_kind: "test_result", source_ref: "test:source-loss",
      source_session_id: undefined, source_turn_id: undefined,
      source_message_sha256: undefined, source_identity_quality: undefined });
    replaceCandidates(f.root, [{ ...original, evidence_refs: [first.id, second.id],
      evidence_ids: [first.id, second.id] }]);
    const patch = f.curate();
    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0]?.default_selected).toBe(true);
    rmSync(f.sessionFile);
    const result = applyPatch(f.root, patch, {
      selectedOpIds: [patch.ops[0]!.op_id],
      now: "2026-10-29T08:05:00Z", trustedTranscriptOptions: f.trustedTranscriptOptions,
    });
    expect(result.applied_ops).toHaveLength(0);
    expect(result.skipped_ops.some(op => op.reason === "capture_policy_hold")).toBe(true);
    expect(loadActiveRecords(f.root)).toHaveLength(0);
  });

  for (const attack of ["statement", "scope", "auto_disabled", "minimum_confidence"] as const) {
    test("automatic apply rebinds " + attack + " even when evidence floor is met", () => {
      const f = isolatedOriginal(durableProjectControls[0]);
      const original = listCandidates(f.root)[0]!;
      const first = readEvidenceRecords(f.root).find(e => e.id === original.evidence_refs[0])!;
      const second = appendEvidenceRecord(f.root, { ...first, id: "r4-binding-second-reference",
        source_kind: "test_result", source_ref: "test:binding",
        source_session_id: undefined, source_turn_id: undefined,
        source_message_sha256: undefined, source_identity_quality: undefined });
      replaceCandidates(f.root, [{ ...original, evidence_refs: [first.id, second.id],
        evidence_ids: [first.id, second.id] }]);
      const patch = f.curate();
      expect(patch.ops).toHaveLength(1);
      expect(patch.ops[0]?.default_selected).toBe(true);
      const op = patch.ops[0]!;
      if (!op.record) throw new Error("Missing ADD record");
      if (attack === "statement") op.record.statement = "For this project, always use fabricated labels.";
      if (attack === "scope") Object.assign(op.record.scope, { project: "foreign-project" });
      if (attack === "auto_disabled" || attack === "minimum_confidence") {
        const cfg = JSON.parse(readFileSync(f.configPath, "utf8"));
        if (attack === "auto_disabled") cfg.curator.autoCurate = "off";
        else cfg.curator.minConfidence = 0.99;
        writeFileSync(f.configPath, JSON.stringify(cfg));
      }
      const result = applyPatch(f.root, patch, {
        selectedOpIds: [op.op_id], now: "2026-10-29T08:06:00Z",
        trustedTranscriptOptions: f.trustedTranscriptOptions,
      });
      expect(result.applied_ops).toHaveLength(0);
      expect(result.skipped_ops.some(x => x.reason === "capture_policy_hold")).toBe(true);
      expect(loadActiveRecords(f.root)).toHaveLength(0);
    });
  }

});
