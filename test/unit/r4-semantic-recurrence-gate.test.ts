import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { semanticRequest, validateSemanticProposal } from "../../src/semantic-assessment";
import { planSemanticCapture } from "../../src/semantic-capture-plan";
import { materializeSemanticCaptureCandidates } from "../../src/semantic-capture-materialize";
import { appendOrReinforceCandidate } from "../../src/capture-recurrence";
import { listCandidates, replaceCandidates } from "../../src/inbox";
import { readEvidenceRecords } from "../../src/evidence";
import { curateInbox } from "../../src/curator";
import { applyPatch } from "../../src/patch";
import { loadActiveRecords } from "../../src/store";
import { hasSemanticReviewLineage } from "../../src/semantic-lineage";
import type { CaptureCandidate, MemoryPatch } from "../../src/types";

const text = "For this project, always run the lapis integrity audit.";
const original = { sessionId: "auth-semantic-2026", turnId: "source-message-1", text };
const projectId = "pi-local-regression";
const now = "2026-10-31T10:30:00.000Z";

function seed(root: string) {
  const req = semanticRequest(original);
  const assessment = validateSemanticProposal(req, {
    version: 1, sourceHash: req.source.hash, outcome: "proposed",
    propositions: [{ start: 0, end: text.length, quote: text,
      disposition: "durable", endorsement: "direct_user",
      duration: "standing", scope: "project" }],
  });
  const plan = planSemanticCapture(original, assessment, projectId);
  expect(materializeSemanticCaptureCandidates(root, original, plan, projectId, now).created).toBe(1);
  return { plan, semantic: listCandidates(root)[0]! };
}

function forgedAuto(patch: MemoryPatch, candidateId: string, suffix: string): MemoryPatch {
  return { ...patch, patch_id: patch.patch_id + suffix, mode: "auto",
    ops: patch.ops.map(op => ({
      ...op, candidate_id: candidateId, default_selected: true, risk: "low",
    })) };
}

describe("R4 semantic evidence lineage cannot launder automatic authority", () => {
  test("legacy recurrence cannot absorb semantic candidate or duplicate evidence on retries", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-semantic-recurrence-"));
    try {
      const { plan, semantic } = seed(root);
      const semanticEvidenceId = semantic.evidence_refs[0]!;
      expect(semanticEvidenceId.startsWith("ev_sem_")).toBe(true);
      const legacy: CaptureCandidate = {
        ...semantic, id: "cap_pref_existing_legacy",
        capture_source: undefined, source: {
          type: "direct_user_instruction", ref: "session:legacy-session:turn:legacy-turn",
        },
        evidence_refs: ["ev_legacy_original"], evidence_ids: ["ev_legacy_original"],
        tags: ["capture", "project_convention"],
        scope_targets: [{ type: "project", project: projectId, confidence: 0.9,
          basis: ["legacy_project_scope"] }],
        promotion_eligibility: "auto_candidate",
      };
      const added = appendOrReinforceCandidate(root, legacy);
      expect(added.action).toBe("created");
      expect(listCandidates(root)).toHaveLength(2);
      expect(listCandidates(root).find(c => c.id === semantic.id)!.evidence_refs)
        .toEqual([semanticEvidenceId]);
      expect(listCandidates(root).find(c => c.id === legacy.id)!.evidence_refs)
        .toEqual(["ev_legacy_original"]);
      for (let i = 0; i < 3; i++) {
        const replay = materializeSemanticCaptureCandidates(root, original, plan,
          projectId, "2026-10-31T10:31:00.000Z");
        expect(replay).toMatchObject({ created: 0, already_present: 1, canonical_writes: 0 });
      }
      expect(readEvidenceRecords(root).map(ev => ev.id)).toEqual([semanticEvidenceId]);
      expect(listCandidates(root)).toHaveLength(2);
      expect(loadActiveRecords(root)).toHaveLength(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("merged semantic evidence and erased v2 metadata both block forged automatic L2", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-semantic-taint-"));
    try {
      const { semantic } = seed(root);
      const rows = listCandidates(root);
      const semanticEvidenceId = semantic.evidence_refs[0]!;
      const legacy: CaptureCandidate = {
        ...semantic, id: "cap_pref_legacy_merged", capture_source: undefined,
        tags: ["capture"], normalized_preference_key: "project_convention:lapis integrity audit",
        evidence_refs: ["ev_legacy_original", semanticEvidenceId],
        evidence_ids: ["ev_legacy_original", semanticEvidenceId],
        promotion_eligibility: "auto_candidate",
        source: { type: "direct_user_instruction", ref: "session:legacy:turn:legacy" },
        scope_targets: [{ type: "project", project: projectId,
          confidence: 0.9, basis: ["explicit_project_scope"] }],
      };
      rows.push(legacy);
      replaceCandidates(root, rows);
      expect(hasSemanticReviewLineage(legacy, readEvidenceRecords(root))).toBe(true);
      const automatic = curateInbox(root, { mode: "auto", now });
      expect(automatic.ops).toHaveLength(0);
      expect(loadActiveRecords(root)).toHaveLength(0);

      // Synthetic forged operation: auto patch forged from a known record
      // schema, but the candidate authority is independently revalidated.
      const oldReview: MemoryPatch = {
        patch_id: "patch_semantic_forgery", created_at: now,
        generated_by: "curator", mode: "supervised", summary: "Untrusted test patch",
        status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [],
        ops: [{
          op_id: "op_001", op: "add", risk: "low", default_selected: false,
          candidate_id: semantic.id, target: "memory/L2.playbooks.jsonl",
          record: {
            id: "mem_semantic_forgery", layer: "L2",
            scope: { type: "project", project: projectId },
            statement: text, tags: [], evidence: [{
              type: "artifact", ref: semanticEvidenceId, note: "Synthetic attempt" }],
            confidence: 0.9, stability: "semi-stable",
            created_at: "2026-10-31", updated_at: "2026-10-31",
            review: { cadence_days: 30, next_review: "2026-11-30",
              change_condition: "Re-evaluate if superseded." },
            status: "active", supersedes: [], superseded_by: [], vault_ref: null,
          },
        }],
      };
      for (const id of [semantic.id, legacy.id]) {
        const forged = forgedAuto(oldReview, id, "_" + id);
        const receipt = applyPatch(root, forged, {
          now, selectedOpIds: ["op_001"],
        });
        expect(receipt.applied_ops).toHaveLength(0);
        expect(receipt.skipped_ops.some(skip => skip.reason === "capture_policy_hold")).toBe(true);
        expect(loadActiveRecords(root)).toHaveLength(0);
      }

      // Erasing mutable v2 fields does not erase evidence-derived taint.
      replaceCandidates(root, listCandidates(root).map(c => c.id === semantic.id
        ? {
            ...c, capture_source: undefined, tags: ["capture"],
            scope_targets: [{ type: "project", project: projectId,
              confidence: 0.9, basis: ["explicit_project_scope"] }],
            promotion_eligibility: "auto_candidate",
          } : c));
      const erased = listCandidates(root).find(c => c.id === semantic.id)!;
      expect(hasSemanticReviewLineage(erased, readEvidenceRecords(root))).toBe(true);
      expect(curateInbox(root, { mode: "auto", now }).ops).toHaveLength(0);
      const after = applyPatch(root, forgedAuto(oldReview, semantic.id, "_erased"), {
        now, selectedOpIds: ["op_001"],
      });
      expect(after.applied_ops).toHaveLength(0);
      expect(after.skipped_ops.some(skip => skip.reason === "capture_policy_hold")).toBe(true);
      expect(loadActiveRecords(root)).toHaveLength(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
