import { describe, expect, test } from "bun:test";
import { inferMemoryKind, normalizeMemoryKind } from "../../src/memory-kind";
import { runMemoryDiagnostics } from "../../src/diagnostics";
import { buildRecallXray } from "../../src/recall-xray";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord } from "../../src/store";
import { appendCandidate } from "../../src/inbox";
import { curateInbox } from "../../src/curator";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryRecord } from "../../src/types";

function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-kind-")); ensureMemoryDirs(dir); return dir; }
function rec(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["workflow"],
    statement: "Always run bun test before committing.",
    evidence: [{ type: "manual", ref: "ev1", note: "support" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-06-01",
    updated_at: "2026-06-01",
    review: { cadence_days: 30, next_review: "2026-07-01", change_condition: "If tooling changes." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...overrides,
  };
}

describe("memory kind taxonomy", () => {
  test("preserves explicit memory kind", () => {
    expect(normalizeMemoryKind("instruction")).toBe("instruction");
  });

  test("old records without memory kind still load and infer a kind", () => {
    const legacy = rec("mem_legacy");
    expect((legacy as any).memory_kind).toBeUndefined();
    expect(inferMemoryKind(legacy)).toBe("instruction");
  });

  test("kind inference covers basic examples", () => {
    expect(inferMemoryKind(rec("mem_fact", { statement: "This project uses Bun for tests.", tags: ["convention"] }))).toBe("fact");
    expect(inferMemoryKind(rec("mem_event", { statement: "Published version 0.9.0 on npm.", tags: ["release"] }))).toBe("event");
    expect(inferMemoryKind(rec("mem_task", { statement: "Follow up by checking npm listing.", tags: ["task"] }))).toBe("task");
  });

  test("explicit memory kind is preserved from candidate into curated record", () => {
    const r = root();
    appendCandidate(r, { id: "cap_kind", created_at: "2026-06-01T00:00:00Z", source: { type: "manual", ref: "daily" }, text: "Published version 0.9.0.", tags: ["release"], evidence_refs: ["daily", "CHANGELOG.md"], confidence: 0.9, status: "new", memory_kind: "event" });
    const patch = curateInbox(r, { now: "2026-06-01T00:01:00Z", mode: "propose" });
    expect(patch.ops[0].record?.memory_kind).toBe("event");
    rmSync(r, { recursive: true, force: true });
  });

  test("diagnostics and recall x-ray show kind when available", () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec("mem_kind", { memory_kind: "instruction" }));
    const diagnostics = runMemoryDiagnostics(r);
    expect(diagnostics.findings.some((f) => f.code === "memory_kind_taxonomy" && f.message.includes("instruction"))).toBe(true);
    const xray = buildRecallXray(r, { query: "bun test", profile_id: "default", resource_id: "default", working_directory: r });
    expect(xray.included[0].memory_kind).toBe("instruction");
    rmSync(r, { recursive: true, force: true });
  });
});
