import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { semanticRequest, validateSemanticProposal } from "../../src/semantic-assessment";
import { planSemanticCapture } from "../../src/semantic-capture-plan";
import { materializeSemanticCaptureCandidates } from "../../src/semantic-capture-materialize";
import { listCandidates, replaceCandidates } from "../../src/inbox";
import { readEvidenceRecords } from "../../src/evidence";
import { writeJsonl } from "../../src/jsonl";
import { ensureMemoryDirs } from "../../src/paths";
import { resolveProjectIdentity } from "../../src/profile";
import { verifyCandidateTranscriptSource } from "../../src/transcript-proof";
import { curateInbox } from "../../src/curator";
import { applyPatch } from "../../src/patch";
import { readCanonicalGeneration } from "../../src/governance-generation";
import { loadActiveRecords } from "../../src/store";
import { semanticCandidateId, semanticEvidenceId, semanticProposalSourceBindingMatches } from "../../src/semantic-source-binding";
import type { EvidenceRecord } from "../../src/types";

const now = "2026-10-31T14:00:00.000Z";
const message = "For this project, always verify the lapis release manifest.";
const sessionId = "same-session-actual";
const turnA = "turn-A-original";
const turnB = "turn-B-identical";

function transcript(sessionFile: string, cwd: string, changedOriginal: boolean) {
  const aText = changedOriginal ? message.replace("lapis", "cobalt") : message;
  writeFileSync(sessionFile, [
    JSON.stringify({ type: "session", id: sessionId, cwd }),
    JSON.stringify({ type: "message", id: turnA,
      message: { role: "user", content: [{ type: "text", text: aText }] } }),
    JSON.stringify({ type: "message", id: turnB,
      message: { role: "user", content: [{ type: "text", text: message }] } }),
    "",
  ].join("\n"));
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-r4-source-rebinding-"));
  const store = join(root, "store"), project = join(root, "project"), sessions = join(root, "sessions");
  mkdirSync(project, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  const sessionFile = join(sessions, "session.jsonl");
  const projectId = resolveProjectIdentity(project).project_id;
  const original = { sessionId, turnId: turnA, text: message };
  const req = semanticRequest(original);
  const review = validateSemanticProposal(req, {
    version: 1, sourceHash: req.source.hash, outcome: "proposed",
    propositions: [{ start: 0, end: message.length, quote: message,
      disposition: "durable", endorsement: "direct_user", duration: "standing", scope: "project" }],
  });
  const plan = planSemanticCapture(original, review, projectId);
  expect(materializeSemanticCaptureCandidates(store, original, plan, projectId, now).created).toBe(1);
  transcript(sessionFile, project, false);
  const originalCandidate = listCandidates(store)[0]!;
  const originalEvidence = readEvidenceRecords(store)[0]!;
  const proofOptions = { trustedSessionDirs: [sessions] };
  expect(verifyCandidateTranscriptSource(originalCandidate, originalEvidence, proofOptions).verified).toBe(true);
  const patch = curateInbox(store, { now, mode: "supervised", trustedTranscriptOptions: proofOptions });
  expect(patch.ops).toHaveLength(1);
  expect(patch.ops[0]!.default_selected).toBe(false);
  const op = patch.ops[0]!;
  expect(op.supportingEvidence?.find(e => e.id === originalEvidence.id)?.source_turn_id).toBe(turnA);
  expect(semanticProposalSourceBindingMatches(originalCandidate, originalEvidence, op)).toBe(true);
  return { root, store, project, sessions, sessionFile, projectId, originalCandidate, originalEvidence, patch, proofOptions };
}

function relabelToTurnB(f: ReturnType<typeof fixture>) {
  const expectedRef = `session:${sessionId}:turn:${turnB}`;
  const tamperedCandidate = {
    ...f.originalCandidate,
    source: { ...f.originalCandidate.source, ref: expectedRef },
    source_turn_ids: [`${sessionId}:${turnB}`],
    capture_source: {
      ...f.originalCandidate.capture_source!,
      turn_id: turnB,
    },
  };
  replaceCandidates(f.store, [tamperedCandidate]);
  const tamperedEvidence = {
    ...f.originalEvidence, source_turn_id: turnB,
    source_ref: expectedRef,
  };
  writeJsonl(ensureMemoryDirs(f.store).memory.evidence, [tamperedEvidence]);
  // V2 proof itself must now reject relabelled content-addressed identity.
  expect(verifyCandidateTranscriptSource(tamperedCandidate, tamperedEvidence, f.proofOptions).verified).toBe(false);
  expect(semanticProposalSourceBindingMatches(tamperedCandidate, tamperedEvidence, f.patch.ops[0]!)).toBe(false);
  return { tamperedCandidate, tamperedEvidence };
}

describe("R4 original proposal cannot be rebound from A to identical-text B", () => {
  for (const changedOriginal of [false, true]) {
    test(changedOriginal
      ? "changed A + identical B cannot authorize unchanged proposal for A"
      : "rewriting candidate and evidence to B cannot authorize unchanged proposal for A", () => {
      const f = fixture();
      try {
        if (changedOriginal) transcript(f.sessionFile, f.project, true);
        else expect(verifyCandidateTranscriptSource(f.originalCandidate, f.originalEvidence, f.proofOptions).verified).toBe(true);
        // The repro mutates both stored representations. The old proof
        // accepted genuine turn B, but the new source-ID invariant rejects it.
        const { tamperedCandidate } = relabelToTurnB(f);
        const source = tamperedCandidate.capture_source;
        if (!source || source.version !== 2) throw new Error("expected semantic-v2 fixture");
        expect(tamperedCandidate.id).not.toBe(semanticCandidateId(
          source.session_id, source.turn_id, source.original_message_sha256,
          source.proposition_start, source.proposition_end, f.projectId,
        ));
        expect(f.patch.ops[0]!.supportingEvidence?.[0]?.source_turn_id).toBe(turnA);
        const result = applyPatch(f.store, f.patch, {
          selectedOpIds: [f.patch.ops[0]!.op_id],
          now: "2026-10-31T14:01:00.000Z",
          trustedTranscriptOptions: f.proofOptions,
        });
        expect(result.applied_ops).toHaveLength(0);
        expect(result.skipped_ops.some(s => s.reason === "capture_policy_hold")).toBe(true);
        expect(loadActiveRecords(f.store)).toHaveLength(0);
        expect(readCanonicalGeneration(f.store)).toBe(0);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    });
  }

  test("source A still applies with unchanged A proposal while same-text B exists", () => {
    const f = fixture();
    try {
      const source = f.originalCandidate.capture_source;
      if (!source || source.version !== 2) throw new Error("expected semantic-v2 fixture");
      const expectedCandidateId = semanticCandidateId(
        source.session_id, source.turn_id, source.original_message_sha256,
        source.proposition_start, source.proposition_end, f.projectId,
      );
      expect(f.originalCandidate.id).toBe(expectedCandidateId);
      expect(f.originalEvidence.id).toBe(semanticEvidenceId(
        expectedCandidateId, source.original_message_sha256,
        source.proposition_start, source.proposition_end,
      ));
      const result = applyPatch(f.store, f.patch, {
        selectedOpIds: [f.patch.ops[0]!.op_id],
        now: "2026-10-31T14:02:00.000Z",
        trustedTranscriptOptions: f.proofOptions,
      });
      expect(result.applied_ops).toEqual([f.patch.ops[0]!.op_id]);
      expect(loadActiveRecords(f.store)).toHaveLength(1);
      expect(readCanonicalGeneration(f.store)).toBe(1);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  const changedSnapshotCases: Array<{
    label: string;
    change: (original: EvidenceRecord) => EvidenceRecord;
  }> = [
    { label: "source_identity_quality changed to unresolved",
      change: row => ({ ...row, source_identity_quality: "unresolved" }) },
    { label: "trust_class changed to agent_inference",
      change: row => ({ ...row, trust_class: "agent_inference" }) },
    { label: "source kind replaced with generated_content",
      change: row => ({ ...row, source_kind: "generated_content" }) },
    { label: "polarity changed from supports",
      change: row => ({ ...row, polarity: "qualifies" }) },
    { label: "evidence redaction status changed",
      change: row => ({ ...row, redaction_status: "redacted" }) },
    { label: "resource identity changed",
      change: row => ({ ...row, resource_id: "other-resource" }) },
    { label: "tags replaced with untrusted evidence",
      change: row => ({ ...row, tags: ["agent-inference"] }) },
    { label: "additional unexpected proposal evidence field",
      change: row => ({ ...row, source_file: "/forged/source.txt" }) },
  ];

  for (const change of changedSnapshotCases) {
    test("altered proposal snapshot " + change.label + " cannot authorize governed L2", () => {
      const f = fixture();
      try {
        const op = f.patch.ops[0]!;
        const evidenceSnapshot = op.supportingEvidence?.[0];
        expect(evidenceSnapshot).toBeDefined();
        const changed = change.change(evidenceSnapshot!);
        const patch = {
          ...f.patch, patch_id: f.patch.patch_id + "_snapshot_" +
            change.label.replace(/[^a-z0-9]+/gi, "_"),
          ops: [{ ...op, supportingEvidence: [changed] }],
        };
        expect(semanticProposalSourceBindingMatches(f.originalCandidate,
          f.originalEvidence, patch.ops[0]!)).toBe(false);
        // Unmodified source A remains independently authentic; only the
        // retained source snapshot attached to the proposal was weakened.
        expect(verifyCandidateTranscriptSource(f.originalCandidate,
          f.originalEvidence, f.proofOptions).verified).toBe(true);
        const applied = applyPatch(f.store, patch, {
          selectedOpIds: [op.op_id],
          now: "2026-10-31T14:04:00.000Z",
          trustedTranscriptOptions: f.proofOptions,
        });
        expect(applied.applied_ops).toHaveLength(0);
        expect(applied.skipped_ops.some(item => item.reason === "capture_policy_hold"))
          .toBe(true);
        expect(loadActiveRecords(f.store)).toHaveLength(0);
        expect(readCanonicalGeneration(f.store)).toBe(0);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    });
  }

  test("a proposal without the original supporting-source snapshot cannot apply", () => {
    const f = fixture();
    try {
      const altered = { ...f.patch, patch_id: f.patch.patch_id + "_missing_source_snapshot",
        ops: f.patch.ops.map(op => ({ ...op, supportingEvidence: [] })) };
      const result = applyPatch(f.store, altered, {
        selectedOpIds: [altered.ops[0]!.op_id],
        now: "2026-10-31T14:03:00.000Z",
        trustedTranscriptOptions: f.proofOptions,
      });
      expect(result.applied_ops).toHaveLength(0);
      expect(result.skipped_ops.some(s => s.reason === "capture_policy_hold")).toBe(true);
      expect(loadActiveRecords(f.store)).toHaveLength(0);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});
