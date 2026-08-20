import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendCandidate, listCandidates } from "../../src/inbox";
import { curateInbox } from "../../src/curator";
import { applyPatch } from "../../src/patch";
import { loadActiveRecords } from "../../src/store";
import { appendEvidenceRecord, readEvidenceRecords } from "../../src/evidence";

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

  test("materializes capture evidence through the governed add operation", () => {
    const root = tempRoot();
    ensureMemoryDirs(root);
    appendEvidenceRecord(root, { id: "ev_capture", resource_id: "curation", profile_id: "legacy-default", created_at: "2026-05-08T00:00:00Z", source_kind: "conversation", source_ref: "session:s1:turn:t1", source_summary: "Use patch files before canonical writes.", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: [] });
    appendCandidate(root, {
      id: "cap_evidence", created_at: "2026-05-08T00:00:00Z",
      source: { type: "direct_user_instruction", ref: "session:s1:turn:t1" },
      text: "Use patch files before canonical writes.", tags: ["workflow"],
      evidence_refs: ["ev_capture"], confidence: 0.9, status: "new",
      primary_trust_class: "direct_user_instruction", durability_signal: "project",
    });
    const patch = curateInbox(root, { now: "2026-05-08T01:00:00Z", mode: "propose", minEvidenceCount: 1 });
    expect(patch.ops[0].supportingEvidence).toHaveLength(1);
    expect(patch.ops[0].supportingEvidence?.[0].related_memory_ids).toEqual([patch.ops[0].record!.id]);
    expect(patch.ops[0].record?.evidence.map((item) => item.ref)).toContain(patch.ops[0].supportingEvidence?.[0].id);

    const result = applyPatch(root, patch, { selectedOpIds: [patch.ops[0].op_id], now: "2026-05-08T02:00:00Z" });
    expect(result.applied_ops).toEqual([patch.ops[0].op_id]);
    expect(readEvidenceRecords(root)).toHaveLength(1);
    expect(loadActiveRecords(root)[0].evidence.map((item) => item.ref)).toContain(readEvidenceRecords(root)[0].id);
  });

  test("keeps unresolved evidence-only candidates reviewable while applying unrelated ops", () => {
    const root = tempRoot();
    ensureMemoryDirs(root);
    appendEvidenceRecord(root, { id: "ev_resolved", resource_id: "curation", profile_id: "legacy-default", created_at: "2026-05-08T00:00:00Z", source_kind: "conversation", source_ref: "session:s2:turn:t2", source_summary: "Run checks before release.", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: [] });
    appendCandidate(root, { id: "cap_unresolved", created_at: "2026-05-08T00:00:00Z", source: { type: "direct_user_instruction", ref: "external:unknown" }, text: "Unverified preference.", tags: ["preference"], evidence_refs: ["external:unknown"], confidence: 0.9, status: "new" });
    appendCandidate(root, { id: "cap_resolved", created_at: "2026-05-08T00:00:00Z", source: { type: "direct_user_instruction", ref: "session:s2:turn:t2" }, text: "Run checks before release.", tags: ["workflow"], evidence_refs: ["ev_resolved"], confidence: 0.9, status: "new", primary_trust_class: "direct_user_instruction" });
    const patch = curateInbox(root, { now: "2026-05-08T01:00:00Z", mode: "propose", minEvidenceCount: 1 });
    const result = applyPatch(root, patch, { selectedOpIds: patch.ops.map((op) => op.op_id), now: "2026-05-08T02:00:00Z" });
    expect(result.applied_ops).toHaveLength(1);
    expect(result.skipped_ops).toContainEqual(expect.objectContaining({ candidate_id: "cap_unresolved", reason: "unresolved_evidence" }));
    expect(listCandidates(root).find((item) => item.id === "cap_unresolved")?.status).toBe("new");
    expect(listCandidates(root).find((item) => item.id === "cap_resolved")?.status).toBe("patched");
  });

  test("rejects cross-profile evidence as unrelated", () => {
    const root = tempRoot();
    ensureMemoryDirs(root);
    appendEvidenceRecord(root, { id: "ev_other", resource_id: "other-resource", profile_id: "other-profile", created_at: "2026-05-08", source_kind: "conversation", source_summary: "Other claim.", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["other-memory"] });
    appendCandidate(root, { id: "cap_cross", created_at: "2026-05-08", resource_id: "resource", profile_id: "profile", source: { type: "direct_user_instruction", ref: "session:s3:turn:t3" }, text: "Claim without its own evidence.", tags: ["workflow"], evidence_refs: ["ev_other"], confidence: 0.9, status: "new" });
    const patch = curateInbox(root, { now: "2026-05-08T01:00:00Z", mode: "propose", minEvidenceCount: 1 });
    const result = applyPatch(root, patch, { selectedOpIds: patch.ops.map((op) => op.op_id), now: "2026-05-08T02:00:00Z" });
    expect(result.skipped_ops).toContainEqual(expect.objectContaining({ candidate_id: "cap_cross", reason: "unresolved_evidence" }));
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
