import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord as addMemoryRecord } from "../../src/store";
import { buildRetrievalContext, readLastInjectionStats } from "../../src/retriever";
import { renderHardRulesBlockWithCount } from "../../src/rules";
import { appendDailyLog } from "../../src/daily";
import { appendRuntimeEvent, readRecentRuntimeEvents } from "../../src/runtime-events";
import { runMemoryDiagnostics, renderDiagnosticsReport } from "../../src/diagnostics";
import { enqueueBackgroundAnalysis, listBackgroundAnalysisJobs, runBackgroundAnalysisQueue } from "../../src/background-analysis";
import type { MemoryRecord } from "../../src/types";
import type { MemoryFtsIndex } from "../../src/search/fts";

let tempDirs: string[] = [];
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "pi-runtime-hardening-"));
  tempDirs.push(dir);
  ensureMemoryDirs(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function record(id: string, layer: "L1" | "L2", statement: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer,
    scope: { type: "global" },
    tags: ["retrieval", "qmd", "playbook"],
    statement,
    evidence: [{ type: "manual", ref: "test", note: "test" }],
    confidence: 0.9,
    stability: "stable",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    review: { cadence_days: 30, next_review: "2026-12-01", change_condition: "test" },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...extra,
  };
}

function fts(ids: string[]): MemoryFtsIndex {
  return { isAvailable: true, search: () => ids.map((id, index) => ({ id, statement: id, layer: "L2", confidence: 0.9, score: index + 1 })), sync: () => {}, close: () => {} } as unknown as MemoryFtsIndex;
}

describe("hard-rule count", () => {
  test("structured renderer reports exact rule count", () => {
    expect(renderHardRulesBlockWithCount([]).count).toBe(0);
    expect(renderHardRulesBlockWithCount([]).block).toBe("");
    const rules = renderHardRulesBlockWithCount([
      record("avoid1", "L2", "avoid one", { ruleType: "avoid_pattern" }),
      record("avoid2", "L2", "avoid two", { ruleType: "avoid_pattern" }),
      record("prefer1", "L2", "prefer one", { ruleType: "prefer_pattern" }),
      record("rule1", "L2", "rule one", { ruleType: "correction" }),
      record("conv1", "L2", "convention one", { ruleType: "convention" }),
      record("soft", "L2", "not hard"),
    ]);
    expect(rules.count).toBe(5);
    expect(rules.block).toContain("⚠️  AVOID:");
    expect(rules.block).toContain("✓  PREFER:");
    expect(rules.block).toContain("📌 RULE:");
    expect(rules.block).toContain("📌 CONVENTION:");
  });
});

describe("retrieval hardening", () => {
  test("uses one record snapshot for processors and contested memory", async () => {
    const root = tempRoot();
    addMemoryRecord(root, record("mem_active", "L2", "active qmd workflow"));
    addMemoryRecord(root, record("mem_contested", "L2", "contested qmd workflow", { status: "contested" }));
    const context = await buildRetrievalContext(root, { prompt: "how should qmd retrieval workflow behave in this project", today: "2026-06-15" });
    expect(context.selectedMemory.map((r) => r.id)).toContain("mem_active");
    expect(context.contestedMemory.map((r) => r.id)).toContain("mem_contested");
  });

  test("short prompt skips qmd while FTS fallback works", async () => {
    const root = tempRoot();
    addMemoryRecord(root, record("mem_l2", "L2", "semantic retrieval playbook"));
    let qmdCalls = 0;
    const context = await buildRetrievalContext(root, { prompt: "qmd retrieval", today: "2026-06-15", ftsIndex: fts(["mem_l2"]), useQmd: true, qmdCollection: "test", qmdRunner: async () => { qmdCalls++; return { stdout: "[]" }; } });
    expect(qmdCalls).toBe(0);
    expect(context.selectedMemory.map((r) => r.id)).toContain("mem_l2");
    expect(readLastInjectionStats(root)?.timings?.qmdMs).toBe(0);
  });

  test("qmd unavailable falls back to FTS without throwing", async () => {
    const root = tempRoot();
    addMemoryRecord(root, record("mem_l2", "L2", "semantic retrieval playbook"));
    const context = await buildRetrievalContext(root, { prompt: "this is a substantial retrieval prompt that should call semantic qmd", today: "2026-06-15", ftsIndex: fts(["mem_l2"]), useQmd: true, qmdCollection: "test", qmdRunner: async () => { throw new Error("offline"); } });
    expect(context.selectedMemory.map((r) => r.id)).toContain("mem_l2");
  });

  test("quick qmd results are merged with FTS results", async () => {
    const root = tempRoot();
    addMemoryRecord(root, record("mem_fts_l2", "L2", "fts retrieval playbook"));
    addMemoryRecord(root, record("mem_semantic_l2", "L2", "semantic retrieval playbook"));
    const context = await buildRetrievalContext(root, { prompt: "this is a substantial retrieval prompt that should call semantic qmd", today: "2026-06-15", ftsIndex: fts(["mem_fts_l2"]), useQmd: true, qmdCollection: "test", qmdRunner: async () => ({ stdout: JSON.stringify({ results: [{ path: "memory/mem_semantic_l2.md" }] }) }) });
    expect(context.selectedMemory.map((r) => r.id)).toContain("mem_semantic_l2");
  });

  test("split L1/L2 budgets prevent L1 starvation by default and respect overrides", async () => {
    const root = tempRoot();
    for (let i = 0; i < 10; i++) addMemoryRecord(root, record(`l1_${i}`, "L1", `identity ${i}`));
    for (let i = 0; i < 5; i++) addMemoryRecord(root, record(`l2_${i}`, "L2", `qmd retrieval ${i}`));
    let context = await buildRetrievalContext(root, { prompt: "qmd retrieval", today: "2026-06-15", maxRecords: 12 });
    expect(context.selectedMemory.filter((r) => r.layer === "L2").length).toBeGreaterThanOrEqual(4);
    expect(context.selectedMemory.length).toBeLessThanOrEqual(12);

    writeFileSync(join(root, "config.json"), JSON.stringify({ retrieval: { maxL1Records: 0 } }), "utf-8");
    context = await buildRetrievalContext(root, { prompt: "qmd retrieval", today: "2026-06-15", maxRecords: 12 });
    expect(context.selectedMemory.some((r) => r.layer === "L1")).toBe(false);

    writeFileSync(join(root, "config.json"), JSON.stringify({ retrieval: { maxL1Records: 12, maxL2Records: 0 } }), "utf-8");
    context = await buildRetrievalContext(root, { prompt: "qmd retrieval", today: "2026-06-15", maxRecords: 12 });
    expect(context.selectedMemory.every((r) => r.layer === "L1")).toBe(true);
  });

  test("per-section caps preserve order and add truncation marker", async () => {
    const root = tempRoot();
    addMemoryRecord(root, record("rule", "L2", "hard rule", { ruleType: "correction" }));
    addMemoryRecord(root, record("long_l2", "L2", "qmd ".repeat(2000)));
    appendDailyLog(root, "2026-06-15", "- daily line\n".repeat(1000));
    const context = await buildRetrievalContext(root, { prompt: "qmd retrieval", today: "2026-06-15", maxDailyChars: 200 });
    expect(context.markdown).toContain("[...truncated]");
    expect(context.markdown.indexOf("## Hard Rules")).toBeLessThan(context.markdown.indexOf("## Selected Memory"));
    expect(context.markdown.indexOf("## Selected Memory")).toBeLessThan(context.markdown.indexOf("## Daily Log"));
  });

  test("injection stats include non-negative timings", async () => {
    const root = tempRoot();
    addMemoryRecord(root, record("mem_l2", "L2", "qmd retrieval"));
    await buildRetrievalContext(root, { prompt: "qmd retrieval", today: "2026-06-15" });
    const timings = readLastInjectionStats(root)?.timings;
    expect(timings).toBeDefined();
    for (const value of Object.values(timings!)) expect(value).toBeGreaterThanOrEqual(0);
  });
});

describe("runtime events and diagnostics", () => {
  test("runtime events redact secrets and filter by age/severity", () => {
    const root = tempRoot();
    appendRuntimeEvent(root, { type: "warn", severity: "low", component: "test", message: "low event", timestamp: "2026-06-15T00:00:00Z" });
    appendRuntimeEvent(root, { type: "error", severity: "medium", component: "test", message: "token sk-abcdefghijklmnopqrstuvwxyz123456", timestamp: new Date().toISOString() });
    const events = readRecentRuntimeEvents(root);
    expect(events).toHaveLength(1);
    expect(events[0].message).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
  });

  test("doctor displays performance and recent events without event file", async () => {
    const root = tempRoot();
    addMemoryRecord(root, record("mem_l2", "L2", "qmd retrieval"));
    await buildRetrievalContext(root, { prompt: "qmd retrieval", today: "2026-06-15" });
    let markdown = renderDiagnosticsReport(runMemoryDiagnostics(root));
    expect(markdown).toContain("## Injection Performance");
    expect(markdown).toContain("No notable events in the last 24 hours.");

    appendRuntimeEvent(root, { type: "warn", severity: "medium", component: "background", message: "job failed", timestamp: new Date().toISOString() });
    markdown = renderDiagnosticsReport(runMemoryDiagnostics(root));
    expect(markdown).toContain("[medium] background");
  });
});

describe("background queue hardening", () => {
  test("lock skips active second run and preserves queue", () => {
    const root = tempRoot();
    enqueueBackgroundAnalysis(root, { kind: "diagnostics" }, "2026-06-15T00:00:00Z");
    const lock = join(root, "runtime", "background-analysis", "jobs.lock");
    ensureMemoryDirs(root);
    writeFileSync(lock, JSON.stringify({ created_at: new Date().toISOString() }), "utf-8");
    const jobs = runBackgroundAnalysisQueue(root, { now: new Date().toISOString() });
    expect(jobs[0].status).toBe("queued");
    expect(readRecentRuntimeEvents(root, { minSeverity: "low" }).some((e) => e.message.includes("skipped"))).toBe(true);
  });

  test("stale running job is recovered and queued jobs still run", () => {
    const root = tempRoot();
    const queue = join(root, "runtime", "background-analysis", "jobs.json");
    enqueueBackgroundAnalysis(root, { kind: "diagnostics" }, "2026-06-15T00:00:00Z");
    writeFileSync(queue, JSON.stringify([
      { id: "old", kind: "diagnostics", created_at: "2026-06-15T00:00:00Z", started_at: "2026-06-15T00:00:00Z", status: "running" },
      { id: "next", kind: "diagnostics", created_at: "2026-06-15T00:10:00Z", status: "queued" }
    ], null, 2), "utf-8");
    const jobs = runBackgroundAnalysisQueue(root, { now: "2026-06-15T00:10:01Z" });
    expect(jobs.find((j) => j.id === "old")?.status).toBe("failed");
    expect(jobs.find((j) => j.id === "next")?.status).toBe("succeeded");
    expect(readRecentRuntimeEvents(root, { minSeverity: "medium", hours: 24 * 365 }).some((e) => e.message.includes("stale"))).toBe(true);
    expect(existsSync(join(root, "runtime", "background-analysis", "jobs.lock"))).toBe(false);
  });

  test("slow job adds warning and writes runtime event while succeeding", () => {
    const root = tempRoot();
    enqueueBackgroundAnalysis(root, { kind: "diagnostics" }, "2026-06-15T00:00:00Z");
    const jobs = runBackgroundAnalysisQueue(root, { now: "2026-06-15T00:00:01Z", slowJobThresholdMs: -1 });
    expect(jobs[0].status).toBe("succeeded");
    expect(jobs[0].warnings?.some((warning) => warning.includes("slow_job"))).toBe(true);
    expect(readRecentRuntimeEvents(root, { hours: 24 * 365 }).some((event) => event.message.includes("slow"))).toBe(true);
  });

  test("job failure writes runtime event", () => {
    const root = tempRoot();
    enqueueBackgroundAnalysis(root, { kind: "diagnostics" }, "2026-06-15T00:00:00Z");
    const jobs = runBackgroundAnalysisQueue(root, { now: "2026-06-15T00:00:01Z", supportedKinds: ["memory_graph"] });
    expect(jobs[0].status).toBe("failed");
    expect(readRecentRuntimeEvents(root, { hours: 24 * 365 }).some((event) => event.message.includes("failed"))).toBe(true);
  });
});
