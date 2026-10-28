import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processCaptureTurn } from "../../src/capture-coordinator";
import { writeDefaultConfig } from "../../src/config";
import { listCandidates } from "../../src/inbox";
import { retryVerifiedSourceCandidatesAtSessionStart } from "../../src/next-session-source-retry";
import { buildRetrievalContext, syncFtsIndex } from "../../src/retriever";
import { MemoryFtsIndex } from "../../src/search/fts";
import { loadActiveRecords } from "../../src/store";
import { appendCandidate } from "../../src/inbox";

const roots: string[] = [];
afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0; });

const statement = "For this project, always use the heliocopper release verification checklist.";

function fixture(sourceAware: "off" | "transcript-verified-direct-user" = "transcript-verified-direct-user",
  autoCurate: "off" | "high-only" | "all-eligible" = "high-only") {
  const root = mkdtempSync(join(tmpdir(), "pi-startup-source-retry-"));
  roots.push(root);
  const cwd = join(root, "project");
  const sessions = join(root, "sessions");
  mkdirSync(cwd);
  mkdirSync(sessions);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "pi-startup-retry-test", private: true }));
  const configPath = writeDefaultConfig(root);
  const cfg = JSON.parse(readFileSync(configPath, "utf8"));
  cfg.governance.mode = "compatibility";
  cfg.curator.sourceAwareAuto = sourceAware;
  cfg.curator.autoCurate = autoCurate;
  cfg.curator.minEvidenceCount = 2;
  writeFileSync(configPath, JSON.stringify(cfg));
  const captured = processCaptureTurn(root, {
    session_id: "previous-session",
    turn_id: "previous-runtime-turn",
    message: statement, launch_cwd: cwd, actions: [],
    now: "2026-10-28T07:00:00Z",
  });
  expect(captured.candidates_created).toBe(1);
  const file = join(sessions, "previous-session.jsonl");
  const persist = (content = statement, role = "user") => {
    const rows = [
      { type: "session", version: 3, id: "previous-session", timestamp: "2026-10-28T07:00:00Z", cwd },
      { type: "message", id: "original-recorded-turn", timestamp: "2026-10-28T07:00:01Z",
        message: { role, content: [{ type: "text", text: content }] } },
    ];
    writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  };
  const options = {
    now: "2026-10-28T08:00:00Z",
    trustedTranscriptOptions: { trustedSessionDirs: [sessions] },
  };
  return { root, cwd, file, sessions, options, persist };
}

describe("R3a opt-in next-session source retry", () => {
  test("unflushed source remains pending; after transcript appears next startup creates one governed L2 and FTS recall", async () => {
    const f = fixture();
    const before = retryVerifiedSourceCandidatesAtSessionStart(f.root, f.options);
    expect(before.status).toBe("held");
    expect(before.selected_ops).toBe(0);
    expect(listCandidates(f.root)).toHaveLength(1);
    expect(listCandidates(f.root)[0]?.status).toBe("new");
    expect(loadActiveRecords(f.root)).toHaveLength(0);

    f.persist();
    const result = retryVerifiedSourceCandidatesAtSessionStart(f.root, f.options);
    expect(result.status).toBe("applied");
    expect(result.applied_ops).toBe(1);
    expect(result.selected_ops).toBe(1);
    expect(result.apply_receipt?.applied_ops).toHaveLength(1);
    expect(listCandidates(f.root)[0]?.status).toBe("patched");
    expect(loadActiveRecords(f.root)).toHaveLength(1);

    const again = retryVerifiedSourceCandidatesAtSessionStart(f.root, f.options);
    expect(again.status).toBe("no_attributable_candidate");
    expect(again.applied_ops).toBe(0);
    expect(loadActiveRecords(f.root)).toHaveLength(1);

    const fts = new MemoryFtsIndex(join(f.root, "search", "fts.db"));
    try {
      syncFtsIndex(f.root, fts);
      expect(fts.search("heliocopper", 5).length).toBeGreaterThan(0);
      const recall = await buildRetrievalContext(f.root, {
        prompt: "What heliocopper checklist should I follow before releasing?",
        cwd: f.cwd, today: "2026-10-28", ftsIndex: fts, useQmd: false,
      });
      expect(recall.selectedMemory.some((record) => record.statement.includes("heliocopper"))).toBe(true);
    } finally { fts.close(); }
  });

  test("five genuinely distinct candidates progress across two same-minute startups without receipt aliasing", () => {
    const f = fixture();
    f.persist();
    const statements = [
      "For this project, always verify security signatures before publishing releases.",
      "For this project, always publish release notes after each production deployment.",
      "For this project, always archive release audit logs for traceability.",
      "For this project, always validate dependency hashes before release tagging.",
    ];
    for (let index = 0; index < statements.length; index++) {
      const sessionId = `other-session-${index}`;
      const message = statements[index]!;
      const created = processCaptureTurn(f.root, {
        session_id: sessionId,
        turn_id: `runtime-turn-${index}`,
        message, launch_cwd: f.cwd, actions: [],
        now: "2026-10-28T07:00:00Z",
      });
      expect(created.candidates_created).toBe(1);
      const rows = [
        { type: "session", version: 3, id: sessionId,
          timestamp: "2026-10-28T07:00:00Z", cwd: f.cwd },
        { type: "message", id: `recorded-entry-${index}`,
          timestamp: "2026-10-28T07:00:01Z",
          message: { role: "user", content: [{ type: "text", text: message }] } },
      ];
      writeFileSync(join(f.sessions, `${sessionId}.jsonl`),
        rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    }
    expect(listCandidates(f.root).filter((c) => c.status === "new")).toHaveLength(5);

    const first = retryVerifiedSourceCandidatesAtSessionStart(f.root, {
      ...f.options, now: "2026-10-28T08:00:01Z",
    });
    expect(first.selected_ops).toBe(3);
    expect(first.applied_ops).toBe(3);
    expect(first.apply_receipt?.applied_ops).toHaveLength(3);
    expect(loadActiveRecords(f.root)).toHaveLength(3);
    expect(listCandidates(f.root).filter((c) => c.status === "new")).toHaveLength(2);

    const second = retryVerifiedSourceCandidatesAtSessionStart(f.root, {
      ...f.options, now: "2026-10-28T08:00:02Z",
    });
    expect(second.proposed_patch?.patch_id).not.toBe(first.proposed_patch?.patch_id);
    expect(second.selected_ops).toBe(2);
    expect(second.applied_ops).toBe(2);
    expect(second.apply_receipt?.applied_ops).toHaveLength(2);
    expect(loadActiveRecords(f.root)).toHaveLength(5);
    expect(new Set(loadActiveRecords(f.root).map((m) => m.id)).size).toBe(5);
    expect(listCandidates(f.root).filter((c) => c.status === "new")).toHaveLength(0);
    const third = retryVerifiedSourceCandidatesAtSessionStart(f.root, {
      ...f.options, now: "2026-10-28T08:00:03Z",
    });
    expect(third.status).toBe("no_attributable_candidate");
    expect(third.applied_ops).toBe(0);
  });

  test("default disabled policy performs no curation or canonical writes even with valid original", () => {
    const f = fixture("off");
    f.persist();
    const result = retryVerifiedSourceCandidatesAtSessionStart(f.root, f.options);
    expect(result.status).toBe("disabled");
    expect(result.considered_candidates).toBe(0);
    expect(loadActiveRecords(f.root)).toHaveLength(0);
    expect(listCandidates(f.root)[0]?.status).toBe("new");
  });

  test("explicit autoCurate=off cannot be overridden by source-aware opt-in", () => {
    const f = fixture("transcript-verified-direct-user", "off");
    f.persist();
    const result = retryVerifiedSourceCandidatesAtSessionStart(f.root, f.options);
    expect(result.status).toBe("disabled");
    expect(loadActiveRecords(f.root)).toHaveLength(0);
  });

  test("assistant role and tampered original transcript remain held", () => {
    for (const role of ["assistant", "user"]) {
      const f = fixture();
      f.persist(role === "user" ? statement + " TAMPERED" : statement, role);
      const result = retryVerifiedSourceCandidatesAtSessionStart(f.root, f.options);
      expect(result.status).toBe("held");
      expect(result.applied_ops).toBe(0);
      expect(loadActiveRecords(f.root)).toHaveLength(0);
      expect(listCandidates(f.root)[0]?.status).toBe("new");
    }
  });

  test("retry excludes unrelated multi-reference candidates and legacy entries", () => {
    const f = fixture();
    const initial = listCandidates(f.root)[0]!;
    // This unrelated record is not a new transcript-attributable single source.
    appendCandidate(f.root, {
      ...initial, id: "cap_two_references", capture_source: undefined,
      evidence_refs: ["legacy-evidence-1", "legacy-evidence-2"],
      evidence_ids: ["legacy-evidence-1", "legacy-evidence-2"],
      source: { type: "tool_result", ref: "legacy" }, text: "Unrelated legacy record",
    });
    f.persist();
    const outcome = retryVerifiedSourceCandidatesAtSessionStart(f.root, f.options);
    expect(outcome.applied_ops).toBe(1);
    expect(listCandidates(f.root).find((item) => item.id === "cap_two_references")?.status).toBe("new");
    expect(loadActiveRecords(f.root)).toHaveLength(1);
  });
});
