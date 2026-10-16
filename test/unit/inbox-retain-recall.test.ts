import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendCandidate, listCandidates } from "../../src/inbox";
import { appendEvidenceRecord } from "../../src/evidence";
import { curateInbox } from "../../src/curator";
import { applyPatchAndSync } from "../../index";
import { loadActiveRecords } from "../../src/store";
import { MemoryFtsIndex } from "../../src/search/fts";
import { buildRetrievalContext } from "../../src/retriever";

const roots: string[] = [];
afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0; });

describe("reviewed inbox retain to recall", () => {
  test("a manually approved candidate is patched, indexed, and eligible for recall", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-retain-recall-"));
    roots.push(root);
    ensureMemoryDirs(root);
    appendEvidenceRecord(root, {
      id: "ev_retain_recall",
      resource_id: "curation",
      profile_id: "legacy-default",
      created_at: "2026-10-16T08:00:00Z",
      source_kind: "conversation",
      source_ref: "session:s1:turn:t1",
      source_summary: "Always use lemonmetric fixtures for release checks.",
      trust_class: "direct_user_instruction",
      polarity: "supports",
      related_memory_ids: [],
    });
    appendCandidate(root, {
      id: "cap_retain_recall",
      created_at: "2026-10-16T08:00:00Z",
      source: { type: "direct_user_instruction", ref: "session:s1:turn:t1" },
      text: "Always use lemonmetric fixtures for release checks",
      tags: ["release", "fixtures"],
      evidence_refs: ["ev_retain_recall"],
      evidence_ids: ["ev_retain_recall"],
      confidence: 0.92,
      status: "new",
      primary_trust_class: "direct_user_instruction",
      durability_signal: "long_term",
      scope_targets: [{ type: "global", confidence: 0.92, basis: ["test_fixture"] }],
    });
    const patch = curateInbox(root, {
      now: "2026-10-16T09:00:00Z",
      mode: "propose",
      minEvidenceCount: 1,
    });
    expect(patch.ops).toHaveLength(1);
    const fts = new MemoryFtsIndex(join(root, "search", "fts.db"));
    try {
      const applied = applyPatchAndSync(root, patch, {
        selectedOpIds: [patch.ops[0]!.op_id], now: "2026-10-16T09:01:00Z",
      }, fts);
      expect(applied.applied_ops).toEqual([patch.ops[0]!.op_id]);
      expect(listCandidates(root).find((candidate) => candidate.id === "cap_retain_recall")?.status).toBe("patched");
      expect(loadActiveRecords(root).some((record) => record.statement.includes("lemonmetric"))).toBe(true);
      expect(fts.search("lemonmetric", 5).some((result) => result.statement.includes("lemonmetric"))).toBe(true);
      const recalled = await buildRetrievalContext(root, {
        prompt: "Which lemonmetric fixtures should we use for release checks in this project?",
        today: "2026-10-16",
        cwd: root,
        ftsIndex: fts,
        useQmd: false,
      });
      expect(recalled.selectedMemory.some((record) => record.statement.includes("lemonmetric"))).toBe(true);
    } finally {
      fts.close();
    }
  });
});
