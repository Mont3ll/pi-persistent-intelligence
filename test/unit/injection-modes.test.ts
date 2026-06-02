import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord } from "../../src/store";
import { buildRetrievalContext, readLastInjectionStats } from "../../src/retriever";
import type { MemoryRecord } from "../../src/types";

function root(): string { const r = mkdtempSync(join(tmpdir(), "pi-inject-mode-")); ensureMemoryDirs(r); return r; }
function config(root: string, mode: "scoped" | "policy_only" | "wakeup") { writeFileSync(join(root, "config.json"), JSON.stringify({ retrieval: { injectionMode: mode } }, null, 2)); }
function rec(statement = "Always use bun test for verification."): MemoryRecord { return { id: "mem_mode", layer: "L2", scope: { type: "global" }, tags: ["testing", "workflow"], statement, evidence: [{ type: "manual", ref: "ev1", note: "support" }], confidence: 0.95, stability: "stable", created_at: "2026-05-01", updated_at: "2026-05-01", review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If tooling changes." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null, ruleType: "testing" }; }

describe("retrieval injection modes", () => {
  test("default remains scoped and includes selected memory", async () => {
    const r = root();
    unsafeAddMemoryRecord(r, rec());
    const ctx = await buildRetrievalContext(r, { prompt: "How should I run bun tests?", today: "2026-06-01", cwd: r });
    expect(ctx.markdown).toContain("Always use bun test for verification.");
    expect(ctx.selectedMemory).toHaveLength(1);
    rmSync(r, { recursive: true, force: true });
  });

  test("policy_only does not inject raw selected memory records", async () => {
    const r = root();
    config(r, "policy_only");
    unsafeAddMemoryRecord(r, rec("Secret project preference text should not appear."));
    const ctx = await buildRetrievalContext(r, { prompt: "What memory applies?", today: "2026-06-01", cwd: r });
    expect(ctx.markdown).toContain("PI memory exists");
    expect(ctx.markdown).toContain("memory_search");
    expect(ctx.markdown).not.toContain("Secret project preference text should not appear.");
    expect(ctx.selectedMemory).toHaveLength(0);
    rmSync(r, { recursive: true, force: true });
  });

  test("wakeup stays compact and writes runtime stats", async () => {
    const r = root();
    config(r, "wakeup");
    unsafeAddMemoryRecord(r, rec("Raw wakeup record should not appear."));
    const ctx = await buildRetrievalContext(r, { prompt: "Start work", today: "2026-06-01", cwd: r });
    expect(ctx.markdown.length).toBeLessThan(1200);
    expect(ctx.markdown).toContain("Wake-up Context");
    expect(ctx.markdown).not.toContain("Raw wakeup record should not appear.");
    const stats = readLastInjectionStats(r);
    expect(stats?.injectionMode).toBe("wakeup");
    expect(stats?.charCount).toBe(ctx.markdown.length);
    rmSync(r, { recursive: true, force: true });
  });
});
