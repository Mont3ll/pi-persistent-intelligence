import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../../src/config";
import { ensureMemoryDirs } from "../../src/paths";
import { resolveProjectIdentity } from "../../src/profile";
import { promoteSemanticTurnAutomatically } from "../../src/semantic-auto-promote";
import { semanticAutoCurrentStateAllowsNewAdd } from "../../src/semantic-auto-current-state";
import { semanticRequest, validateSemanticProposal, type OriginalTurn, type SemanticAdapter } from "../../src/semantic-assessment";
import { planSemanticCapture } from "../../src/semantic-capture-plan";
import { materializeSemanticCaptureCandidates } from "../../src/semantic-capture-materialize";
import { curateInbox } from "../../src/curator";
import { applyPatch } from "../../src/patch";
import { readCanonicalGeneration } from "../../src/governance-generation";
import { listCandidates } from "../../src/inbox";
import { loadActiveRecords } from "../../src/store";
import { matchCandidateToRecords } from "../../src/matching";
import type { MemoryPatch, MemoryRecord } from "../../src/types";

const now = "2026-11-08T10:00:00.000Z";
const policy = "For this project, always run the lapis integrity audit.";
const original: OriginalTurn = {
  sessionId: "semantic-race-session",
  turnId: "semantic-race-user-A",
  text: "This is an unrelated implementation report. ".repeat(12) + policy,
};

function setup() {
  const tmp = mkdtempSync(join(tmpdir(), "pi-semantic-auto-fence-"));
  const root = join(tmp, "store"), project = join(tmp, "project"), sessions = join(tmp, "sessions");
  mkdirSync(project, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  const projectId = resolveProjectIdentity(project).project_id;
  const paths = ensureMemoryDirs(root);
  writeFileSync(paths.config, JSON.stringify({
    ...defaultConfig, curator: {
      ...defaultConfig.curator, semanticAuto: "guarded-project",
    },
  }));
  writeFileSync(join(sessions, "session.jsonl"), [
    JSON.stringify({ type: "session", id: original.sessionId, cwd: project }),
    JSON.stringify({ type: "message", id: original.turnId,
      message: { role: "user", content: [{ type: "text", text: original.text }] } }),
    "",
  ].join("\n"));
  return { tmp, root, project, projectId, sessions };
}

function proposal() {
  const req = semanticRequest(original);
  const start = original.text.indexOf(policy);
  return {
    version: 1, sourceHash: req.source.hash, outcome: "proposed",
    propositions: [{
      start, end: start + policy.length, quote: policy,
      disposition: "durable", endorsement: "direct_user", duration: "standing", scope: "project",
    }],
  };
}

function assess(): SemanticAdapter {
  return { assess: async () => proposal() };
}

function options(f: ReturnType<typeof setup>, adapter: SemanticAdapter = assess()) {
  return {
    root: f.root, original, projectId: f.projectId,
    now, adapter,
    trustedTranscriptOptions: { trustedSessionDirs: [f.sessions] },
  };
}

function seedCandidate(f: ReturnType<typeof setup>) {
  const req = semanticRequest(original);
  const checked = validateSemanticProposal(req, proposal());
  const plan = planSemanticCapture(original, checked, f.projectId);
  expect(materializeSemanticCaptureCandidates(f.root, original, plan, f.projectId, now).created).toBe(1);
  return listCandidates(f.root)[0]!;
}

/**
 * Derive the schema and normalized key from the actual curator proposal,
 * then commit owner rules through genuine governed transactions. A fabricated
 * memory array or ungoverned direct write cannot stand in for this test.
 */
function ownerWrite(f: ReturnType<typeof setup>, id: string, statement: string) {
  const draft = curateInbox(f.root, {
    now, mode: "supervised", minEvidenceCount: 1,
    trustedTranscriptOptions: { trustedSessionDirs: [f.sessions] },
  });
  const template = draft.ops.find(op => op.op === "add")?.record;
  if (!template) throw new Error("curator template not available");
  const record: MemoryRecord = {
    ...template, id, statement,
    // Match the candidate's canonical identity while changing its instruction.
    normalized_key: template.normalized_key,
    evidence: [{ type: "manual", ref: `owner:${id}`, note: "Independent approved owner rule" }],
  };
  const patch: MemoryPatch = {
    patch_id: `patch_owner_semantic_${id}`, generated_by: "manual",
    mode: "supervised", created_at: now, summary: "Owner governed L2 update",
    status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [],
    ops: [{
      op_id: `op_owner_${id}`, op: "add", risk: "low",
      default_selected: false, target: "memory/L2.playbooks.jsonl", record,
    }],
  };
  const receipt = applyPatch(f.root, patch, {
    now, selectedOpIds: [patch.ops[0]!.op_id],
  });
  expect(receipt.applied_ops).toEqual([patch.ops[0]!.op_id]);
  return receipt;
}

describe("R4 semantic auto conflict and proposal generation fencing", () => {
  test("two actual same-key owner rules create an explicit ambiguous curator hold", async () => {
    const f = setup();
    try {
      const candidate = seedCandidate(f);
      ownerWrite(f, "mem_owner_one", "For this project, do not run the lapis integrity audit.");
      ownerWrite(f, "mem_owner_two",
        "For this project, run the lapis integrity audit only with owner approval.");
      expect(loadActiveRecords(f.root)).toHaveLength(2);
      const match = matchCandidateToRecords(candidate, loadActiveRecords(f.root));
      expect(match.match_kind).toBe("ambiguous");
      expect(semanticAutoCurrentStateAllowsNewAdd(f.root, candidate)).toBe(false);

      const review = curateInbox(f.root, {
        now, mode: "supervised", minEvidenceCount: 1,
        trustedTranscriptOptions: { trustedSessionDirs: [f.sessions] },
      });
      const op = review.ops.find(x => x.candidate_id === candidate.id)!;
      expect(op.rationale).toContain("manual merge/review");

      const before = readCanonicalGeneration(f.root);
      const result = await promoteSemanticTurnAutomatically(options(f));
      expect(result.applied_ops).toBe(0);
      expect(result.reason).toBe("canonical_match_or_verification_requires_review");
      expect(loadActiveRecords(f.root)).toHaveLength(2);
      expect(readCanonicalGeneration(f.root)).toBe(before);
    } finally { rmSync(f.tmp, { recursive: true, force: true }); }
  });

  test("one existing opposed rule must require review even if matcher calls it strengthens_existing", async () => {
    const f = setup();
    try {
      const candidate = seedCandidate(f);
      ownerWrite(f, "mem_owner_opposed", "For this project, do not run the lapis integrity audit.");
      const match = matchCandidateToRecords(candidate, loadActiveRecords(f.root));
      expect(match.match_kind).not.toBe("new");
      expect(semanticAutoCurrentStateAllowsNewAdd(f.root, candidate)).toBe(false);
      const result = await promoteSemanticTurnAutomatically(options(f));
      expect(result.applied_ops).toBe(0);
      expect(loadActiveRecords(f.root)).toHaveLength(1);
      expect(readCanonicalGeneration(f.root)).toBe(1);
    } finally { rmSync(f.tmp, { recursive: true, force: true }); }
  });

  for (const scenario of [
    { label: "unrelated", statement: "For this project, the cobalt runbook must be updated each Wednesday." },
    { label: "opposed", statement: "For this project, do not run the lapis integrity audit." },
  ]) {
    test("owner transaction during the second assessment fences stale " + scenario.label + " proposal", async () => {
      const f = setup();
      try {
        let calls = 0;
        const adapter: SemanticAdapter = {
          assess: async () => {
            calls++;
            if (calls === 2) ownerWrite(f, `mem_owner_race_${scenario.label}`, scenario.statement);
            return proposal();
          },
        };
        const result = await promoteSemanticTurnAutomatically(options(f, adapter));
        expect(calls).toBe(2);
        expect(result.applied_ops).toBe(0);
        expect(result.reason).toBe("canonical_generation_changed_after_proposal");
        expect(loadActiveRecords(f.root).map(x => x.statement)).toEqual([scenario.statement]);
        expect(readCanonicalGeneration(f.root)).toBe(1);
      } finally { rmSync(f.tmp, { recursive: true, force: true }); }
    });
  }

  test("fresh source with no matching canonical rules retains the positive automatic L2 path", async () => {
    const f = setup();
    try {
      const result = await promoteSemanticTurnAutomatically(options(f));
      expect(result.status).toBe("applied");
      expect(result.applied_ops).toBe(1);
      expect(loadActiveRecords(f.root).map(x => x.statement)).toEqual([policy]);
      expect(readCanonicalGeneration(f.root)).toBe(1);
    } finally { rmSync(f.tmp, { recursive: true, force: true }); }
  });
});
