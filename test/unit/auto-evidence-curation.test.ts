import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCaptureSourceAttribution } from "../../src/capture-provenance";
import { writeDefaultConfig } from "../../src/config";
import { ensureMemoryDirs } from "../../src/paths";
import { appendEvidenceRecord } from "../../src/evidence";
import { appendCandidate, listCandidates } from "../../src/inbox";
import { curateInbox as curateInboxBase } from "../../src/curator";
import { applyPatch as applyPatchBase } from "../../src/patch";
import { loadActiveRecords } from "../../src/store";
import type { CaptureCandidate, EvidenceRecord } from "../../src/types";

const roots: string[] = [];
afterEach(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); roots.length = 0; });
const original = "For this project, always use the verified release checklist.";
const source = buildCaptureSourceAttribution("actual-session", "actual-turn", original, original);
const reference = "session:actual-session:turn:actual-turn";

function trustedTranscriptOptions(root: string) {
  return { trustedSessionDirs: [join(root, "trusted-sessions")] };
}
function curateInbox(root: string, opts: Parameters<typeof curateInboxBase>[1]) {
  return curateInboxBase(root, { ...opts, trustedTranscriptOptions: trustedTranscriptOptions(root) });
}
function applyPatch(root: string, patch: Parameters<typeof applyPatchBase>[1], opts: Parameters<typeof applyPatchBase>[2]) {
  return applyPatchBase(root, patch, { ...opts, trustedTranscriptOptions: trustedTranscriptOptions(root) });
}


function setup(verified: boolean, enabled: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "pi-source-aware-auto-"));
  roots.push(root);
  const projectCwd = join(root, "project");
  const sessionDir = join(root, "trusted-sessions");
  mkdirSync(projectCwd);
  mkdirSync(sessionDir);
  writeFileSync(join(projectCwd, "package.json"), JSON.stringify({ name: "pi", private: true }));
  // A real source-of-record Pi JSONL transcript, not an evidence flag, is
  // the only proof accepted by the R0d production eligibility path.
  if (verified) {
    const rows = [
      { type: "session", version: 3, id: source.session_id,
        timestamp: "2026-10-28T08:00:00Z", cwd: projectCwd },
      { type: "message", id: "persisted-user-entry",
        timestamp: "2026-10-28T08:00:01Z",
        message: { role: "user", content: [{ type: "text", text: original }] } },
    ];
    writeFileSync(join(sessionDir, "actual-session.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  }
  const configPath = writeDefaultConfig(root);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.governance.mode = "compatibility";
  config.curator.sourceAwareAuto = enabled ? "transcript-verified-direct-user" : "off";
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  const evidence: EvidenceRecord = {
    id: "ev_verified_turn", resource_id: "curation", profile_id: "legacy-default",
    created_at: "2026-10-28T08:00:00Z", source_kind: "conversation",
    source_session_id: source.session_id, source_turn_id: source.turn_id,
    source_ref: reference, source_summary: original,
    source_message_sha256: source.original_message_sha256,
    source_identity_quality: "observed_session_id",
    source_transcript_verified: verified,
    notes: "capture_evidence_v1",
    trust_class: "direct_user_instruction", polarity: "supports",
    related_memory_ids: [], redaction_status: "none",
  };
  appendEvidenceRecord(root, evidence);
  const candidate: CaptureCandidate = {
    id: "cap_verified_turn", created_at: "2026-10-28T08:00:00Z",
    source: { type: "direct_user_instruction", ref: reference },
    text: original, capture_source: source,
    tags: ["capture", "project_convention", "release"],
    evidence_refs: [evidence.id], evidence_ids: [evidence.id],
    confidence: 0.96, status: "new",
    memory_kind: "instruction", worth_decision: "candidate",
    capture_intent: "project_convention",
    primary_trust_class: "direct_user_instruction", durability_signal: "project",
    promotion_eligibility: "auto_candidate", poisoning_risk: "low",
    scope_targets: [{ type: "project", project: "pi", confidence: 0.9, basis: ["fixture"] }],
  };
  appendCandidate(root, candidate);
  return root;
}
function configure(root: string, mode: string): void {
  const path = ensureMemoryDirs(root).config;
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  cfg.curator.sourceAwareAuto = mode;
  writeFileSync(path, JSON.stringify(cfg));
}

describe("opt-in source-aware governed curation", () => {
  test("default policy holds a one-reference candidate regardless of a verified marker", () => {
    const root = setup(true, false);
    const patch = curateInbox(root, { now: "2026-10-28T09:00:00Z", mode: "auto" });
    expect(patch.ops).toHaveLength(0);
    expect(loadActiveRecords(root)).toHaveLength(0);
  });

  test("observed but unverified source is never eligible under the opt-in policy", () => {
    const root = setup(false, true);
    const patch = curateInbox(root, { now: "2026-10-28T09:00:00Z", mode: "auto" });
    expect(patch.ops).toHaveLength(0);
  });

  test("explicit opt-in and transcript-verified source can pass full governed curation", () => {
    const root = setup(true, true);
    const patch = curateInbox(root, { now: "2026-10-28T09:00:00Z", mode: "auto", governanceMode: "compatibility" });
    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0]?.default_selected).toBe(true);
    expect(patch.ops[0]?.rationale).toContain("Single transcript-verified authoritative user source");
    const result = applyPatch(root, patch, {
      selectedOpIds: [patch.ops[0]!.op_id], now: "2026-10-28T09:01:00Z",
    });
    expect(result.applied_ops).toEqual([patch.ops[0]!.op_id]);
    expect(listCandidates(root)[0]?.status).toBe("patched");
    expect(loadActiveRecords(root)).toHaveLength(1);
  });

  test("disabling opt-in after proposal prevents stale auto application", () => {
    const root = setup(true, true);
    const patch = curateInbox(root, { now: "2026-10-28T09:00:00Z", mode: "auto", governanceMode: "compatibility" });
    expect(patch.ops[0]?.default_selected).toBe(true);
    configure(root, "off");
    const result = applyPatch(root, patch, {
      selectedOpIds: [patch.ops[0]!.op_id], now: "2026-10-28T09:01:00Z",
    });
    expect(result.applied_ops).toHaveLength(0);
    expect(result.skipped_ops).toContainEqual(expect.objectContaining({ reason: "capture_policy_hold" }));
    expect(loadActiveRecords(root)).toHaveLength(0);
    expect(listCandidates(root)[0]?.status).toBe("new");
  });

  test("removing original transcript after proposal prevents stale auto application", () => {
    const root = setup(true, true);
    const patch = curateInbox(root, { now: "2026-10-28T09:00:00Z", mode: "auto", governanceMode: "compatibility" });
    expect(patch.ops[0]?.default_selected).toBe(true);
    rmSync(join(root, "trusted-sessions", "actual-session.jsonl"));
    // Deliberately retain stored source_transcript_verified=true. The fresh
    // original transcript proof, not the persisted flag, must control apply.
    const result = applyPatch(root, patch, {
      selectedOpIds: [patch.ops[0]!.op_id], now: "2026-10-28T09:01:00Z",
    });
    expect(result.applied_ops).toHaveLength(0);
    expect(result.skipped_ops).toContainEqual(expect.objectContaining({ reason: "capture_policy_hold" }));
    expect(listCandidates(root)[0]?.status).toBe("new");
    expect(loadActiveRecords(root)).toHaveLength(0);
  });

  test("a forged stored verified=true cannot authorize a missing transcript", () => {
    const root = setup(false, true);
    const path = ensureMemoryDirs(root).memory.evidence;
    const rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => {
      const row = JSON.parse(line);
      return JSON.stringify({ ...row, source_transcript_verified: true });
    });
    writeFileSync(path, rows.join("\n") + "\n");
    const patch = curateInbox(root, { now: "2026-10-28T09:00:00Z", mode: "auto" });
    expect(patch.ops).toHaveLength(0);
  });

  test("a real transcript is accepted even when the stored flag is false", () => {
    const root = setup(true, true);
    const path = ensureMemoryDirs(root).memory.evidence;
    const rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => {
      const row = JSON.parse(line);
      return JSON.stringify({ ...row, source_transcript_verified: false });
    });
    writeFileSync(path, rows.join("\n") + "\n");
    const patch = curateInbox(root, {
      now: "2026-10-28T09:00:00Z", mode: "auto", governanceMode: "compatibility",
    });
    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0]?.default_selected).toBe(true);
  });

  test("editing source-aware auto patch scope cannot turn a project instruction global", () => {
    const root = setup(true, true);
    const patch = curateInbox(root, { now: "2026-10-28T09:00:00Z", mode: "auto", governanceMode: "compatibility" });
    expect(patch.ops[0]?.default_selected).toBe(true);
    patch.ops[0]!.record!.scope = { type: "global" };
    const result = applyPatch(root, patch, {
      selectedOpIds: [patch.ops[0]!.op_id], now: "2026-10-28T09:01:00Z",
    });
    expect(result.applied_ops).toHaveLength(0);
    expect(result.skipped_ops).toContainEqual(expect.objectContaining({ reason: "capture_policy_hold" }));
    expect(loadActiveRecords(root)).toHaveLength(0);
  });

  test("autoCurate being switched off invalidates a stale source-aware auto patch", () => {
    const root = setup(true, true);
    const patch = curateInbox(root, { now: "2026-10-28T09:00:00Z", mode: "auto", governanceMode: "compatibility" });
    expect(patch.ops[0]?.default_selected).toBe(true);
    const path = ensureMemoryDirs(root).config;
    const cfg = JSON.parse(readFileSync(path, "utf8"));
    cfg.curator.autoCurate = "off";
    writeFileSync(path, JSON.stringify(cfg));
    const result = applyPatch(root, patch, {
      selectedOpIds: [patch.ops[0]!.op_id], now: "2026-10-28T09:01:00Z",
    });
    expect(result.applied_ops).toHaveLength(0);
    expect(result.skipped_ops).toContainEqual(expect.objectContaining({ reason: "capture_policy_hold" }));
    expect(loadActiveRecords(root)).toHaveLength(0);
  });

  test("stale default_selected cannot bypass a below-floor hold in supervised mode", () => {
    const root = setup(false, false);
    const patch = curateInbox(root, {
      now: "2026-10-28T09:00:00Z", mode: "supervised",
      minEvidenceCount: 1, governanceMode: "compatibility",
    });
    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0]?.default_selected).toBe(false);
    patch.ops[0]!.default_selected = true;
    const result = applyPatch(root, patch, { now: "2026-10-28T09:01:00Z" });
    expect(result.applied_ops).toHaveLength(0);
    expect(result.skipped_ops).toContainEqual(expect.objectContaining({ reason: "capture_policy_hold" }));
    expect(loadActiveRecords(root)).toHaveLength(0);
  });
});
