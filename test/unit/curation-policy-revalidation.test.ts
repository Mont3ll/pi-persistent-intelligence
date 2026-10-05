import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendCandidate } from "../../src/inbox";
import { appendEvidenceRecord } from "../../src/evidence";
import { curateInbox } from "../../src/curator";
import { selectInboxBatchApplyOpIds } from "../../src/curation-selection";
import type { MemoryWorthDecision } from "../../src/types";

const dirs: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-curation-policy-"));
  dirs.push(dir);
  ensureMemoryDirs(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function appendPersistedCaptureCandidate(
  rootDir: string,
  id: string,
  text: string,
  worthDecision: MemoryWorthDecision = "candidate",
): void {
  const evidenceId = `ev_${id}`;
  appendEvidenceRecord(rootDir, {
    id: evidenceId,
    resource_id: "curation",
    profile_id: "legacy-default",
    created_at: "2026-10-03T14:00:00Z",
    source_kind: "conversation",
    source_session_id: "s1",
    source_ref: `session:s1:turn:${id}`,
    source_summary: text,
    trust_class: "user_correction",
    polarity: "supports",
    durability_signal: "project",
    related_memory_ids: [],
    tags: ["capture-evidence"],
    notes: "capture_evidence_v1",
  });
  appendCandidate(rootDir, {
    id,
    created_at: "2026-10-03T14:00:00Z",
    source: { type: "user_correction", ref: `session:s1:turn:${id}` },
    text,
    tags: ["capture", "behavior_correction", "testing", "implementation"],
    evidence_refs: [evidenceId],
    evidence_ids: [evidenceId],
    confidence: 0.9,
    status: "new",
    ruleType: "correction",
    memory_kind: "instruction",
    worth_decision: worthDecision,
    capture_intent: "behavior_correction",
    primary_trust_class: "user_correction",
    source_trust_weight: 1,
    durability_signal: "project",
    promotion_eligibility: "auto_candidate",
    poisoning_risk: "low",
    poisoning_risk_reasons: [],
  });
}

describe("curation current-policy revalidation", () => {
  test("does not auto-select stale capture metadata when current policy says task-bound", () => {
    const dir = root();
    appendPersistedCaptureCandidate(
      dir,
      "cap_stale_task",
      "Verify the final consolidation-evidence provenance head after secondary-review corrections. Do not modify source. Do not mutate the live PI store. Do not modify the divergent configured checkout. Do not create a PR.",
    );

    const patch = curateInbox(dir, {
      now: "2026-10-05T05:00:00Z",
      mode: "auto",
      minEvidenceCount: 1,
      governanceMode: "compatibility",
    });

    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0].candidate_id).toBe("cap_stale_task");
    expect(patch.ops[0].op).toBe("add");
    expect(patch.ops[0].default_selected).toBe(false);
    expect(selectInboxBatchApplyOpIds(patch, 0.75)).toEqual([]);
  });

  test("does not auto-select a captured candidate already scored daily-only", () => {
    const dir = root();
    appendPersistedCaptureCandidate(
      dir,
      "cap_daily_only",
      "Going forward, do not merge, release, or publish unless I explicitly authorize it.",
      "daily_only",
    );

    const patch = curateInbox(dir, {
      now: "2026-10-05T05:00:00Z",
      mode: "auto",
      minEvidenceCount: 1,
      governanceMode: "compatibility",
    });

    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0].candidate_id).toBe("cap_daily_only");
    expect(patch.ops[0].default_selected).toBe(false);
    expect(selectInboxBatchApplyOpIds(patch, 0.75)).toEqual([]);
  });

  test("keeps currently durable captured corrections auto-eligible", () => {
    const dir = root();
    appendPersistedCaptureCandidate(
      dir,
      "cap_durable_control",
      "Going forward, do not merge, release, or publish unless I explicitly authorize it.",
    );

    const patch = curateInbox(dir, {
      now: "2026-10-05T05:00:00Z",
      mode: "auto",
      minEvidenceCount: 1,
      governanceMode: "compatibility",
    });

    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0].candidate_id).toBe("cap_durable_control");
    expect(patch.ops[0].default_selected).toBe(true);
    expect(selectInboxBatchApplyOpIds(patch, 0.75)).toEqual([patch.ops[0].op_id]);
  });
});
