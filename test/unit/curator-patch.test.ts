import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendCandidate, listCandidates } from "../../src/inbox";
import { curateInbox } from "../../src/curator";
import { applyPatch } from "../../src/patch";
import { loadActiveRecords } from "../../src/store";

let tempDirs: string[] = [];
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "pi-pi-curator-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("curator and patch applier", () => {
  test("promotes sufficiently evidenced candidates to L2 add patch ops", () => {
    const root = tempRoot();
    ensureMemoryDirs(root);
    appendCandidate(root, {
      id: "cap_1",
      created_at: "2026-05-08T00:00:00Z",
      source: { type: "daily", ref: "daily/2026-05-08.md" },
      text: "Use patch files before mutating canonical memory.",
      tags: ["workflow", "memory"],
      evidence_refs: ["daily/2026-05-08.md", "docs/spec.md"],
      confidence: 0.82,
      status: "new",
    });

    const patch = curateInbox(root, { now: "2026-05-08T01:00:00Z", mode: "propose" });

    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0].op).toBe("add");
    expect(patch.ops[0].record?.layer).toBe("L2");
    expect(patch.ops[0].record?.statement).toBe("Use patch files before mutating canonical memory.");
  });

  test("leaves weak candidates in the inbox", () => {
    const root = tempRoot();
    ensureMemoryDirs(root);
    appendCandidate(root, {
      id: "cap_weak",
      created_at: "2026-05-08T00:00:00Z",
      source: { type: "daily", ref: "daily/2026-05-08.md" },
      text: "Maybe use a graph database someday.",
      tags: ["idea"],
      evidence_refs: ["daily/2026-05-08.md"],
      confidence: 0.4,
      status: "new",
    });

    const patch = curateInbox(root, { now: "2026-05-08T01:00:00Z", mode: "propose" });

    expect(patch.ops).toHaveLength(0);
    expect(listCandidates(root)[0].status).toBe("new");
  });

  test("applies selected add ops, updates inbox status, writes rendered markdown", () => {
    const root = tempRoot();
    const paths = ensureMemoryDirs(root);
    appendCandidate(root, {
      id: "cap_1",
      created_at: "2026-05-08T00:00:00Z",
      source: { type: "daily", ref: "daily/2026-05-08.md" },
      text: "Render markdown from canonical JSONL after every patch.",
      tags: ["workflow"],
      evidence_refs: ["daily/2026-05-08.md", "docs/spec.md"],
      confidence: 0.8,
      status: "new",
    });
    const patch = curateInbox(root, { now: "2026-05-08T01:00:00Z", mode: "propose" });

    const result = applyPatch(root, patch, { selectedOpIds: patch.ops.map((op) => op.op_id), now: "2026-05-08T02:00:00Z" });

    expect(result.applied_ops).toEqual(["op_001"]);
    expect(loadActiveRecords(root)).toHaveLength(1);
    expect(listCandidates(root)[0].status).toBe("patched");
    expect(readFileSync(paths.rendered.memory, "utf-8")).toContain("Render markdown from canonical JSONL");
  });
});
