import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { semanticRequest, validateSemanticProposal } from "../../src/semantic-assessment";
import { planSemanticCapture } from "../../src/semantic-capture-plan";
import { materializeSemanticCaptureCandidates } from "../../src/semantic-capture-materialize";
import { listCandidates } from "../../src/inbox";
import { readEvidenceRecords } from "../../src/evidence";
import { resolveProjectIdentity } from "../../src/profile";
import { verifyCandidateTranscriptSource } from "../../src/transcript-proof";
import { loadActiveRecords } from "../../src/store";
import { curateInbox } from "../../src/curator";
import { applyPatch } from "../../src/patch";

function makeReview(original: {sessionId:string;turnId:string;text:string}, phrase: string,
  duration: "standing" | "bounded" = "standing") {
  const req = semanticRequest(original);
  const start = original.text.indexOf(phrase);
  expect(start).toBeGreaterThanOrEqual(0);
  return validateSemanticProposal(req, {
    version: 1, sourceHash: req.source.hash, outcome: "proposed",
    propositions: [{
      start, end: start + phrase.length, quote: phrase,
      disposition: duration === "standing" ? "durable" : "temporary",
      endorsement: "direct_user", duration, scope: "project",
    }],
  });
}

describe("R4 source-spanned semantic candidate / transcript proof (isolated)", () => {
  test("later proposition creates exactly one review-only candidate with full original-turn proof", () => {
    const temp = mkdtempSync(join(tmpdir(), "pi-semantic-source-"));
    try {
      const store = join(temp, "memory");
      const project = join(temp, "working-repo");
      const sessions = join(temp, "sessions");
      mkdirSync(project, { recursive: true });
      mkdirSync(sessions, { recursive: true });
      const projectId = resolveProjectIdentity(project).project_id;
      const prefix = "This is an operational report. ".repeat(14);
      const policy = "For this project, always run the lapis integrity audit.";
      const original = { sessionId: "auth-session-123", turnId: "msg-policy-01", text: prefix + policy };
      const review = makeReview(original, policy);
      const plan = planSemanticCapture(original, review, projectId);
      expect(plan.entries[0]?.start).toBeGreaterThan(300);
      expect(plan.entries[0]?.route).toBe("durable_candidate");
      const recorded = materializeSemanticCaptureCandidates(store, original, plan, projectId,
        "2026-10-31T08:00:00.000Z");
      expect(recorded).toMatchObject({ created: 1, already_present: 0, canonical_writes: 0 });
      const candidates = listCandidates(store);
      expect(candidates).toHaveLength(1);
      const candidate = candidates[0]!;
      expect(candidate.text).toBe(policy);
      expect(candidate.capture_source?.version).toBe(2);
      expect(candidate.promotion_eligibility).toBe("review_only");
      expect(loadActiveRecords(store)).toHaveLength(0);
      const evidence = readEvidenceRecords(store).find(x => x.id === candidate.evidence_refs[0]);
      expect(evidence).toBeDefined();

      writeFileSync(join(sessions, "actual-session.jsonl"), [
        JSON.stringify({ type: "session", id: original.sessionId, cwd: project }),
        JSON.stringify({ type: "message", id: original.turnId, message: {
          role: "user", content: [{ type: "text", text: original.text }],
        } }),
        "",
      ].join("\n"));
      const proof = verifyCandidateTranscriptSource(candidate, evidence!, {
        trustedSessionDirs: [sessions],
      });
      expect(proof.verified).toBe(true);
      expect(proof.source_hash).toBe(candidate.capture_source?.original_message_sha256);
      const repeated = materializeSemanticCaptureCandidates(store, original, plan, projectId,
        "2026-10-31T08:01:00.000Z");
      expect(repeated).toMatchObject({ created: 0, already_present: 1, canonical_writes: 0 });
      expect(listCandidates(store)).toHaveLength(1);
      expect(readEvidenceRecords(store)).toHaveLength(1);

      const changedText = original.text.replace("lapis", "forged");
      const changed = { ...original, text: changedText };
      const badPlan = planSemanticCapture(changed, review, projectId);
      expect(badPlan.outcome).toBe("abstain");
      expect(materializeSemanticCaptureCandidates(store, changed, badPlan, projectId,
        "2026-10-31T08:02:00.000Z").created).toBe(0);
      expect(loadActiveRecords(store)).toHaveLength(0);

      // A single verified semantic source is actionable in supervised review,
      // despite the default two-reference auto floor and auto mode OFF.
      const patch = curateInbox(store, {
        now: "2026-10-31T08:03:00.000Z", mode: "supervised",
        trustedTranscriptOptions: { trustedSessionDirs: [sessions] },
      });
      expect(patch.ops).toHaveLength(1);
      expect(patch.ops[0]!.default_selected).toBe(false);
      // Neither curating in auto mode nor rewriting a proposal into an
      // auto-selected operation may promote unratified semantic evidence.
      const automatic = curateInbox(store, {
        now: "2026-10-31T08:03:10.000Z", mode: "auto",
        minEvidenceCount: 1, trustedTranscriptOptions: { trustedSessionDirs: [sessions] },
      });
      expect(automatic.ops).toHaveLength(0);
      const forgedAuto = {
        ...patch, patch_id: patch.patch_id + "_forged_auto",
        mode: "auto" as const,
        ops: patch.ops.map(op => ({ ...op, default_selected: true })),
      };
      const blocked = applyPatch(store, forgedAuto, {
        now: "2026-10-31T08:03:20.000Z",
        selectedOpIds: [patch.ops[0]!.op_id],
        trustedTranscriptOptions: { trustedSessionDirs: [sessions] },
      });
      expect(blocked.applied_ops).toHaveLength(0);
      expect(blocked.skipped_ops.some(skip => skip.reason === "capture_policy_hold")).toBe(true);
      expect(loadActiveRecords(store)).toHaveLength(0);

      const applied = applyPatch(store, patch, {
        selectedOpIds: [patch.ops[0]!.op_id],
        now: "2026-10-31T08:04:00.000Z",
        trustedTranscriptOptions: { trustedSessionDirs: [sessions] },
      });
      expect(applied.applied_ops).toEqual([patch.ops[0]!.op_id]);
      expect(loadActiveRecords(store)).toHaveLength(1);
      expect(loadActiveRecords(store)[0]?.statement).toBe(policy);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  test("time-bounded model proposition cannot create an L2 candidate", () => {
    const temp = mkdtempSync(join(tmpdir(), "pi-semantic-temporary-"));
    try {
      const policy = "For this project, always run the lapis audit tomorrow.";
      const original = { sessionId: "auth-session-456", turnId: "msg-temp-01", text: policy };
      const review = makeReview(original, policy, "bounded");
      const plan = planSemanticCapture(original, review, "repo-project");
      const result = materializeSemanticCaptureCandidates(temp, original, plan,
        "repo-project", "2026-10-31T08:00:00.000Z");
      expect(result.created).toBe(0);
      expect(result.held).toBe(1);
      expect(listCandidates(temp)).toHaveLength(0);
      expect(loadActiveRecords(temp)).toHaveLength(0);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});
