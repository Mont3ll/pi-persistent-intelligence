import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessSingleSourceAutoIntent } from "../../src/capture-semantics";
import { classifyCaptureIntent } from "../../src/capture-intent";
import { processCaptureTurn } from "../../src/capture-coordinator";
import { resolveCaptureScopes } from "../../src/capture-scope";
import { loadConfig, writeDefaultConfig } from "../../src/config";
import { curateInbox } from "../../src/curator";
import { readEvidenceRecords } from "../../src/evidence";
import { listCandidates } from "../../src/inbox";
import { applyPatch } from "../../src/patch";
import { loadActiveRecords } from "../../src/store";
import { verifyCandidateTranscriptSource } from "../../src/transcript-proof";

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  tempRoots.length = 0;
});

function fixture(text: string) {
  const root = mkdtempSync(join(tmpdir(), "pi-r4-semantic-safety-"));
  tempRoots.push(root);
  const cwd = join(root, "project");
  const sessions = join(root, "session-archive");
  mkdirSync(cwd);
  mkdirSync(sessions);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "r4-semantic-safety" }));
  const configFile = writeDefaultConfig(root);
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.governance.mode = "compatibility";
  config.curator.sourceAwareAuto = "transcript-verified-direct-user";
  config.curator.autoCurate = "high-only";
  writeFileSync(configFile, JSON.stringify(config));
  const sessionId = "r4-authoritative-turn";
  processCaptureTurn(root, {
    session_id: sessionId,
    turn_id: "r4-event",
    message: text,
    launch_cwd: cwd,
    actions: [],
    now: "2026-10-29T10:00:00Z",
  });
  const entries = [
    { type: "session", version: 3, id: sessionId,
      timestamp: "2026-10-29T09:59:00Z", cwd },
    { type: "message", id: "r4-original-message",
      timestamp: "2026-10-29T10:00:00Z",
      message: { role: "user", content: [{ type: "text", text }] } },
  ];
  writeFileSync(join(sessions, sessionId + ".jsonl"),
    entries.map((row) => JSON.stringify(row)).join("\n") + "\n");
  const trustedTranscriptOptions = { trustedSessionDirs: [sessions] };
  const curate = () => curateInbox(root, {
    now: "2026-10-29T11:00:00Z",
    mode: "auto",
    governanceMode: "compatibility",
    trustedTranscriptOptions,
  });
  return { root, cwd, sessions, curate, trustedTranscriptOptions };
}

const nondurableCases = [
  ["verification handoff with durable phrase", "Verify this release branch HEAD and run tests. For this project, always run typecheck before pushing. Stop after the report."],
  ["quoted UI example", 'The UI says: "For this project, always run typecheck before pushing."'],
  ["memory opt-out", "Do not save this in memory: for this project, always run typecheck before pushing."],
  ["task-bound test", "For this task, always run typecheck before pushing. For this project, always run typecheck before pushing."],
  ["headed handoff", "RELEASE_VERIFICATION_HANDOFF:\nFor this project, always run typecheck before pushing."],
  ["quoted block", "> For this project, always run typecheck before pushing.\nThis is a sample of the UI output."],
  ["mixed instructions", "For this project, always run typecheck before pushing.\n- For this test, don't publish anything."],
] as const;

const scopeBypasses = [
  "Across all projects, I prefer plain punctuation in documentation.",
  "For all projects, always run typecheck before publishing.",
  "For this project, always run typecheck before publishing across all projects.",
] as const;

describe("R4 semantic automatic-promotion boundary", () => {
  for (const [name, text] of nondurableCases) {
    test(`does not auto-apply original user-role ${name}`, () => {
      const f = fixture(text);
      const candidates = listCandidates(f.root);
      // Some opt-outs and task wrappers should not create any candidate.
      const patch = f.curate();
      expect(patch.ops.filter((op) => op.default_selected)).toHaveLength(0);
      if (candidates.length) {
        const proof = verifyCandidateTranscriptSource(candidates[0]!,
          readEvidenceRecords(f.root)[0]!, f.trustedTranscriptOptions);
        // Valid original transcript authorship is not a semantic grant.
        if (proof.verified) expect(proof.auto_semantic_eligible).toBe(false);
        const allOps = patch.ops.map((op) => op.op_id);
        if (allOps.length) {
          const attempted = applyPatch(f.root, patch, {
            selectedOpIds: allOps, now: "2026-10-29T11:01:00Z",
            trustedTranscriptOptions: f.trustedTranscriptOptions,
          });
          expect(attempted.applied_ops).toEqual([]);
        }
      }
      expect(loadActiveRecords(f.root)).toHaveLength(0);
    });
  }

  for (const text of scopeBypasses) {
    test(`cross-project intent never becomes project-local auto memory: ${text}`, () => {
      const f = fixture(text);
      const candidate = listCandidates(f.root)[0];
      if (candidate) {
        expect(candidate.scope_targets?.[0]?.type).toBe("global");
      }
      const patch = f.curate();
      expect(patch.ops.filter((op) => op.default_selected)).toHaveLength(0);
      if (patch.ops.length) {
        const attempted = applyPatch(f.root, patch, {
          selectedOpIds: patch.ops.map((op) => op.op_id),
          now: "2026-10-29T11:01:00Z",
          trustedTranscriptOptions: f.trustedTranscriptOptions,
        });
        expect(attempted.applied_ops).toEqual([]);
      }
      expect(loadActiveRecords(f.root)).toHaveLength(0);
    });
  }

  test("positive explicitly scoped project convention survives original-turn proof and governed application", () => {
    const text = "For this project, always use the accepted cobalttracer release checklist.";
    const f = fixture(text);
    expect(loadConfig(f.root).curator.minEvidenceCount).toBe(2);
    const candidate = listCandidates(f.root)[0]!;
    expect(candidate.scope_targets?.[0]?.type).toBe("project");
    const proof = verifyCandidateTranscriptSource(candidate,
      readEvidenceRecords(f.root)[0]!, f.trustedTranscriptOptions);
    expect(proof.verified).toBe(true);
    expect(proof.auto_semantic_eligible).toBe(true);
    const patch = f.curate();
    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0]!.default_selected).toBe(true);
    const result = applyPatch(f.root, patch, {
      selectedOpIds: [patch.ops[0]!.op_id],
      now: "2026-10-29T11:01:00Z",
      trustedTranscriptOptions: f.trustedTranscriptOptions,
    });
    expect(result.applied_ops).toEqual([patch.ops[0]!.op_id]);
    expect(loadActiveRecords(f.root)).toHaveLength(1);
  });

  test("explicit memory opt-out takes precedence over an embedded durable phrase", () => {
    const raw = "Do not retain this as a memory. For this project, always use YAML.";
    const classified = classifyCaptureIntent(raw);
    expect(classified.intent).toBe("not_memory");
    expect(classified.reasons).toContain("explicit_memory_opt_out");
    const f = fixture(raw);
    expect(listCandidates(f.root)).toHaveLength(0);
  });

  test("context-free project fallback cannot create a one-source automatic exception", () => {
    const raw = "Always run typecheck before pushing.";
    const f = fixture(raw);
    const candidate = listCandidates(f.root)[0]!;
    expect(candidate.scope_targets?.[0]?.type).toBe("project");
    const scope = candidate.scope_targets![0];
    expect(assessSingleSourceAutoIntent(raw, scope).eligible).toBe(false);
    expect(f.curate().ops.filter((op) => op.default_selected)).toHaveLength(0);
  });

  test("scope remains global for explicit cross-project wording even with a local project mention", () => {
    const text = "For this project, always run checks across all projects.";
    const decision = classifyCaptureIntent(text);
    const scope = resolveCaptureScopes({
      text, decision,
      launch_project: { project_id: "r4-project", source: "cwd_fallback" },
      activity: [],
    });
    expect(scope[0]?.type).toBe("global");
  });
});
