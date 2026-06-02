import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendEvidenceRecord } from "../../src/evidence";
import { appendReinforcementEvent, createReinforcementEvent } from "../../src/reinforcement";
import { unsafeAddMemoryRecord, loadAllRecords } from "../../src/store";
import { appendDeletionTombstone, createDeletionTombstone } from "../../src/tombstones";
import { getMemoryValidity, buildMemoryTimeline } from "../../src/timeline";
import type { MemoryRecord } from "../../src/types";

function root(): string { const r = mkdtempSync(join(tmpdir(), "pi-time-")); ensureMemoryDirs(r); return r; }
function rec(id: string, opts: Partial<MemoryRecord> = {}): MemoryRecord { return { id, layer: "L2", scope: { type: "global" }, tags: ["test"], statement: "Use bun.", evidence: [{ type: "manual", ref: "ev1", note: "support" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-05-01", updated_at: "2026-05-02", review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If contradicted." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null, ...opts }; }

describe("timeline", () => {
  test("infers legacy valid_from from created_at", () => {
    const validity = getMemoryValidity(rec("mem1"), [], []);
    expect(validity.valid_from).toBe("2026-05-01");
  });

  test("superseded record has effective valid_to", () => {
    const old = rec("old", { status: "superseded", superseded_by: ["new"] });
    const replacement = rec("new", { created_at: "2026-06-01", supersedes: ["old"] });
    const validity = getMemoryValidity(old, [], [replacement]);
    expect(validity.valid_to).toBe("2026-06-01");
    expect(validity.invalidated_by).toBe("new");
  });

  test("tombstoned record has effective valid_to", () => {
    const tomb = createDeletionTombstone({ deleted_record_id: "mem1", deletion_mode: "audit_preserving", deletion_reason: "invalid", now: "2026-06-03T00:00:00Z" });
    const validity = getMemoryValidity(rec("mem1"), [tomb], []);
    expect(validity.valid_to).toBe("2026-06-03T00:00:00Z");
    expect(validity.invalidated_by).toBe(tomb.id);
  });

  test("timeline includes evidence and reinforcement events without mutation", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem1"));
    appendEvidenceRecord(r, { id: "ev1", resource_id: "r", profile_id: "p", created_at: "2026-05-03T00:00:00Z", source_kind: "conversation", source_summary: "summary", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem1"], redaction_status: "none" });
    appendReinforcementEvent(r, createReinforcementEvent({ memory_id: "mem1", outcome: "explicit_reinforcement", now: "2026-05-04T00:00:00Z" }));
    const before = loadAllRecords(r).length;
    const timeline = buildMemoryTimeline(r, { memoryId: "mem1" });
    expect(timeline.events.some((e) => e.type === "evidence_created")).toBe(true);
    expect(timeline.events.some((e) => e.type === "reinforcement_event")).toBe(true);
    expect(loadAllRecords(r)).toHaveLength(before);
    rmSync(r, { recursive: true, force: true });
  });
});
