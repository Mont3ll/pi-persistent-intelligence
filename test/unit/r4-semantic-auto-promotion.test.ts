import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../../src/config";
import { ensureMemoryDirs } from "../../src/paths";
import { promoteSemanticTurnAutomatically } from "../../src/semantic-auto-promote";
import { listCandidates } from "../../src/inbox";
import { readEvidenceRecords } from "../../src/evidence";
import { loadActiveRecords } from "../../src/store";
import { readCanonicalGeneration } from "../../src/governance-generation";
import { buildRetrievalContext } from "../../src/retriever";
import { resolveProjectIdentity } from "../../src/profile";
import { curateInbox } from "../../src/curator";
import { applyPatch } from "../../src/patch";
import type { SemanticAdapter, OriginalTurn, SemanticRequest } from "../../src/semantic-assessment";

const now = "2026-11-08T10:00:00.000Z";
const instruction = "For this project, always run the lapis release integrity check.";
const prefix = "A short operational report with no memory directive. ".repeat(12);
const original: OriginalTurn = {
  sessionId: "session-semantic-auto", turnId: "entry-semantic-auto-A",
  text: prefix + instruction,
};

function fixture(enabled: boolean) {
  const tmp = mkdtempSync(join(tmpdir(), "pi-sem-auto-"));
  const root = join(tmp, "store"), project = join(tmp, "project"), sessions = join(tmp, "sessions");
  mkdirSync(project, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  const projectId = resolveProjectIdentity(project).project_id;
  const storePaths = ensureMemoryDirs(root);
  writeFileSync(storePaths.config, JSON.stringify({
    ...defaultConfig, curator: { ...defaultConfig.curator,
      semanticAuto: enabled ? "guarded-project" : "off" },
  }));
  const sessionFile = join(sessions, "session.jsonl");
  writeFileSync(sessionFile, [
    JSON.stringify({ type: "session", id: original.sessionId, cwd: project }),
    JSON.stringify({ type: "message", id: original.turnId,
      message: { role: "user", content: [{ type: "text", text: original.text }] } }),
    "",
  ].join("\n"));
  return { tmp, root, project, projectId, sessions, sessionFile };
}

function assessed(endorsement = "direct_user", duration = "standing", disposition = "durable") {
  const start = original.text.indexOf(instruction);
  return {
    version: 1, sourceHash: createHash("sha256").update(original.text).digest("hex"),
    outcome: "proposed",
    propositions: [{
      start, end: start + instruction.length, quote: instruction,
      disposition, endorsement, duration, scope: "project",
    }],
  };
}

function adapterFor(
  response: (req: SemanticRequest, count: number) => unknown = () => assessed(),
): { adapter: SemanticAdapter; calls: () => number } {
  let n = 0;
  return { adapter: { assess: async (req) => response(req, ++n) }, calls: () => n };
}

describe("R4 opt-in semantic auto L2 guarded end-to-end (isolated stores)", () => {
  test("disabled means no model inference, candidates or L2 changes", async () => {
    const f = fixture(false), a = adapterFor();
    try {
      const result = await promoteSemanticTurnAutomatically({
        root: f.root, projectId: f.projectId, original, now,
        trustedTranscriptOptions: { trustedSessionDirs: [f.sessions] }, adapter: a.adapter,
      });
      expect(result.status).toBe("disabled");
      expect(a.calls()).toBe(0);
      expect(listCandidates(f.root)).toHaveLength(0);
      expect(loadActiveRecords(f.root)).toHaveLength(0);
    } finally { rmSync(f.tmp, { recursive: true, force: true }); }
  });

  test("one late directly endorsed project rule automatically applies once with source proof", async () => {
    const f = fixture(true), a = adapterFor();
    try {
      const run = () => promoteSemanticTurnAutomatically({
        root: f.root, projectId: f.projectId, original, now,
        trustedTranscriptOptions: { trustedSessionDirs: [f.sessions] }, adapter: a.adapter,
      });
      const result = await run();
      expect(a.calls()).toBe(2);
      expect(result).toMatchObject({ status: "applied", candidates_created: 1, applied_ops: 1 });
      expect(result.receipt?.applied_ops).toHaveLength(1);
      expect(listCandidates(f.root)).toHaveLength(1);
      expect(listCandidates(f.root)[0]?.capture_source?.version).toBe(2);
      expect(readEvidenceRecords(f.root)).toHaveLength(1);
      expect(loadActiveRecords(f.root)).toHaveLength(1);
      expect(loadActiveRecords(f.root)[0]?.statement).toBe(instruction);
      expect(readCanonicalGeneration(f.root)).toBe(1);

      // Simulate a different session, without reusing the original message.
      const recall = await buildRetrievalContext(f.root, {
        cwd: f.project, today: "2026-11-09",
        threadId: "session-after-automatic-promotion",
        prompt: "Before the next release, what lapis integrity check should we perform?",
        useQmd: false,
      });
      expect(recall.selectedMemory.some(item => item.statement === instruction)).toBe(true);
      expect(recall.markdown).toContain(instruction);

      const repeated = await run();
      expect(repeated.applied_ops).toBe(0);
      expect(readEvidenceRecords(f.root)).toHaveLength(1);
      expect(loadActiveRecords(f.root)).toHaveLength(1);
      expect(readCanonicalGeneration(f.root)).toBe(1);
    } finally { rmSync(f.tmp, { recursive: true, force: true }); }
  });

  for (const variant of [
    { name: "temporary", endorsement: "direct_user", duration: "bounded", disposition: "temporary" },
    { name: "quoted", endorsement: "quoted", duration: "standing", disposition: "durable" },
    { name: "reported", endorsement: "reported", duration: "standing", disposition: "durable" },
    { name: "unknown duration", endorsement: "direct_user", duration: "unknown", disposition: "durable" },
  ]) {
    test("negative semantic " + variant.name + " never writes L2", async () => {
      const f = fixture(true), a = adapterFor(() =>
        assessed(variant.endorsement, variant.duration, variant.disposition));
      try {
        const result = await promoteSemanticTurnAutomatically({
          root: f.root, projectId: f.projectId, original, now,
          trustedTranscriptOptions: { trustedSessionDirs: [f.sessions] }, adapter: a.adapter,
        });
        expect(result.applied_ops).toBe(0);
        expect(readCanonicalGeneration(f.root)).toBe(0);
        expect(loadActiveRecords(f.root)).toHaveLength(0);
      } finally { rmSync(f.tmp, { recursive: true, force: true }); }
    });
  }

  test("second assessment disagreement retains review-only candidate, never writes", async () => {
    const f = fixture(true), a = adapterFor((_req, count) =>
      count === 1 ? assessed() : assessed("quoted"));
    try {
      const result = await promoteSemanticTurnAutomatically({
        root: f.root, projectId: f.projectId, original, now,
        trustedTranscriptOptions: { trustedSessionDirs: [f.sessions] }, adapter: a.adapter,
      });
      expect(result.applied_ops).toBe(0);
      expect(result.candidates_created).toBe(1);
      expect(listCandidates(f.root)[0]?.promotion_eligibility).toBe("review_only");
      expect(loadActiveRecords(f.root)).toHaveLength(0);
    } finally { rmSync(f.tmp, { recursive: true, force: true }); }
  });

  test("missing original transcript cannot auto-promote even if model claims durable", async () => {
    const f = fixture(true), a = adapterFor();
    try {
      writeFileSync(f.sessionFile, [
        JSON.stringify({ type: "session", id: original.sessionId, cwd: f.project }),
        JSON.stringify({ type: "message", id: "other-turn",
          message: { role: "user", content: [{ type: "text", text: original.text }] } }),
        "",
      ].join("\n"));
      const result = await promoteSemanticTurnAutomatically({
        root: f.root, projectId: f.projectId, original, now,
        trustedTranscriptOptions: { trustedSessionDirs: [f.sessions] }, adapter: a.adapter,
      });
      expect(result.applied_ops).toBe(0);
      expect(listCandidates(f.root)).toHaveLength(1);
      expect(loadActiveRecords(f.root)).toHaveLength(0);
    } finally { rmSync(f.tmp, { recursive: true, force: true }); }
  });

  test("a forged auto-curator patch without ephemeral authorization is still held", async () => {
    const f = fixture(true);
    try {
      const a = adapterFor((_req, count) => count === 1 ? assessed() : assessed("quoted"));
      await promoteSemanticTurnAutomatically({
        root: f.root, projectId: f.projectId, original, now,
        trustedTranscriptOptions: { trustedSessionDirs: [f.sessions] }, adapter: a.adapter,
      });
      const proposal = curateInbox(f.root, {
        now, mode: "supervised",
        trustedTranscriptOptions: { trustedSessionDirs: [f.sessions] },
      });
      expect(proposal.ops).toHaveLength(1);
      const auto = { ...proposal, patch_id: proposal.patch_id + "_forged",
        mode: "auto" as const, ops: proposal.ops.map(op => ({ ...op, default_selected: true })) };
      const receipt = applyPatch(f.root, auto, {
        now, selectedOpIds: [auto.ops[0]!.op_id],
        trustedTranscriptOptions: { trustedSessionDirs: [f.sessions] },
      });
      expect(receipt.applied_ops).toHaveLength(0);
      expect(receipt.skipped_ops.some(s => s.reason === "capture_policy_hold")).toBe(true);
      expect(loadActiveRecords(f.root)).toHaveLength(0);
    } finally { rmSync(f.tmp, { recursive: true, force: true }); }
  });
});
