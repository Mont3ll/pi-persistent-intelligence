import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processCaptureTurn } from "../../src/capture-coordinator";
import { loadConfig, writeDefaultConfig } from "../../src/config";
import { curateInbox } from "../../src/curator";
import { readEvidenceRecords } from "../../src/evidence";
import { listCandidates } from "../../src/inbox";
import { applyPatch } from "../../src/patch";
import { buildRetrievalContext, syncFtsIndex } from "../../src/retriever";
import { MemoryFtsIndex } from "../../src/search/fts";
import { loadActiveRecords } from "../../src/store";

const directories: string[] = [];
afterEach(() => { for (const dir of directories) rmSync(dir, { recursive: true, force: true }); directories.length = 0; });

const statement = "For this project, always use the cobalttracer release verification checklist.";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-r0d-live-proof-"));
  directories.push(root);
  const cwd = join(root, "pi-project");
  const sessions = join(root, "sessions");
  mkdirSync(cwd);
  mkdirSync(sessions);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "pi-proof-acceptance", private: true }));
  const configPath = writeDefaultConfig(root);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.governance.mode = "compatibility";
  config.curator.sourceAwareAuto = "transcript-verified-direct-user";
  writeFileSync(configPath, JSON.stringify(config));
  const captured = processCaptureTurn(root, {
    session_id: "original-session-a", turn_id: "runtime-turn-a",
    message: statement, launch_cwd: cwd, actions: [],
    now: "2026-10-28T07:30:00Z",
  });
  expect(captured.candidates_created).toBe(1);
  const file = join(sessions, "original-session-a.jsonl");
  const originalEntries = [
    { type: "session", version: 3, id: "original-session-a",
      timestamp: "2026-10-28T07:25:00Z", cwd },
    { type: "message", id: "persisted-message-entry",
      timestamp: "2026-10-28T07:30:00Z",
      message: { role: "user", content: [{ type: "text", text: statement }] } },
  ];
  const persistTranscript = () =>
    writeFileSync(file, originalEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  const transcriptOptions = { trustedSessionDirs: [sessions] };
  const curate = () => curateInbox(root, {
    now: "2026-10-28T08:00:00Z", mode: "auto", governanceMode: "compatibility",
    trustedTranscriptOptions: transcriptOptions,
  });
  return { root, cwd, file, persistTranscript, transcriptOptions, curate };
}

describe("R0d source-of-record automatic retention", () => {
  test("one real captured user turn becomes governed L2 and is retrieved with FTS", async () => {
    const f = fixture();
    expect(loadConfig(f.root).curator.minEvidenceCount).toBe(2);
    expect(readEvidenceRecords(f.root)[0]?.source_transcript_verified).toBeUndefined();
    expect(f.curate().ops).toHaveLength(0);
    f.persistTranscript();
    const patch = f.curate();
    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0]?.default_selected).toBe(true);
    expect(patch.ops[0]?.rationale).toContain("Single transcript-verified authoritative user source");
    const result = applyPatch(f.root, patch, {
      selectedOpIds: [patch.ops[0]!.op_id],
      now: "2026-10-28T08:01:00Z", trustedTranscriptOptions: f.transcriptOptions,
    });
    expect(result.applied_ops).toEqual([patch.ops[0]!.op_id]);
    expect(listCandidates(f.root)[0]?.status).toBe("patched");
    expect(loadActiveRecords(f.root)).toHaveLength(1);
    expect(readEvidenceRecords(f.root)[0]?.source_transcript_verified).toBeUndefined();

    const fts = new MemoryFtsIndex(join(f.root, "search", "fts.db"));
    try {
      syncFtsIndex(f.root, fts);
      expect(fts.search("cobalttracer", 5)).not.toHaveLength(0);
      const recalled = await buildRetrievalContext(f.root, {
        prompt: "Which cobalttracer checklist do I follow for releases?",
        cwd: f.cwd, today: "2026-10-28", ftsIndex: fts, useQmd: false,
      });
      expect(recalled.selectedMemory.some((record) => record.statement.includes("cobalttracer"))).toBe(true);
    } finally { fts.close(); }
  });

  test("missing then restored transcript is a recoverable hold; no new candidate", () => {
    const f = fixture();
    expect(f.curate().ops).toHaveLength(0);
    expect(listCandidates(f.root)).toHaveLength(1);
    f.persistTranscript();
    expect(f.curate().ops).toHaveLength(1);
    expect(listCandidates(f.root)).toHaveLength(1);
  });

  test("forged persisted evidence flag does not create eligibility without transcript", () => {
    const f = fixture();
    const path = join(f.root, "memory", "evidence.jsonl");
    const entries = readFileSync(path, "utf8").trim().split("\n").map((line) =>
      JSON.stringify({ ...JSON.parse(line), source_transcript_verified: true }));
    writeFileSync(path, entries.join("\n") + "\n");
    expect(f.curate().ops).toHaveLength(0);
    expect(loadActiveRecords(f.root)).toHaveLength(0);
  });

  test("deleting transcript after curation rejects stale auto patch", () => {
    const f = fixture();
    f.persistTranscript();
    const patch = f.curate();
    expect(patch.ops[0]?.default_selected).toBe(true);
    rmSync(f.file);
    const applied = applyPatch(f.root, patch, {
      selectedOpIds: [patch.ops[0]!.op_id],
      now: "2026-10-28T08:01:00Z", trustedTranscriptOptions: f.transcriptOptions,
    });
    expect(applied.applied_ops).toHaveLength(0);
    expect(applied.skipped_ops.some((skip) => skip.reason === "capture_policy_hold")).toBe(true);
    expect(listCandidates(f.root)[0]?.status).toBe("new");
    expect(loadActiveRecords(f.root)).toHaveLength(0);
  });

  test("the unchanged two-reference policy remains effective when opt-in is disabled", () => {
    const f = fixture();
    f.persistTranscript();
    const configPath = join(f.root, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.curator.sourceAwareAuto = "off";
    writeFileSync(configPath, JSON.stringify(config));
    expect(f.curate().ops).toHaveLength(0);
  });
});
