import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMemoryDiagnostics } from "../../src/diagnostics";
import { ensureMemoryDirs } from "../../src/paths";
import { InvocationProfiler } from "../../src/profiling";
import { buildRecallXray } from "../../src/recall-xray";
import { unsafeAddMemoryRecord } from "../../src/store";
import { InteractiveBrowser } from "../../src/tui/InteractiveBrowser";
import { diagnosticsBrowserOptions, memoryRecordBrowserOptions, recallXrayBrowserOptions } from "../../src/tui/browser-adapters";
import type { MemoryRecord } from "../../src/types";

function record(id: string, i: number): MemoryRecord {
  return { id, layer: "L2", scope: { type: "global" }, tags: ["stress", i % 2 ? "odd" : "even"], statement: `Interactive performance memory ${i} should remain searchable and inspectable without rendering the whole store.`, evidence: [{ type: "manual", ref: `ev_${i}`, note: "support" }], confidence: 0.5 + (i % 50) / 100, stability: "semi-stable", created_at: "2026-07-07", updated_at: "2026-07-07", review: { cadence_days: 30, next_review: "2026-08-07", change_condition: "If performance changes." }, status: "active", supersedes: [], superseded_by: [], vault_ref: null };
}

describe("interactive profiling stress", () => {
  test("large browser interactions and profiled diagnostics stay within local latency targets", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-interactive-perf-"));
    ensureMemoryDirs(root);
    const records = Array.from({ length: 10000 }, (_, i) => record(`mem_perf_${i}`, i));
    for (const rec of records.slice(0, 1000)) unsafeAddMemoryRecord(root, rec);

    const browser = new InteractiveBrowser(memoryRecordBrowserOptions(records));
    const renderStart = performance.now();
    const firstFrame = browser.render(120);
    const firstRenderMs = performance.now() - renderStart;

    const interactionStart = performance.now();
    for (let i = 0; i < 100; i++) browser.handleInput("down");
    browser.handleInput("enter");
    browser.handleInput("/");
    for (const ch of "memory 99") browser.handleInput(ch);
    browser.handleInput("enter");
    browser.handleInput("tab");
    browser.handleInput("S");
    const interactionMs = performance.now() - interactionStart;
    const interactedFrame = browser.render(100);

    const recallProfiler = new InvocationProfiler("recall_xray");
    const recall = buildRecallXray(root, { query: "interactive performance", profiler: recallProfiler, maxRecords: 20 });
    const diagnostics = runMemoryDiagnostics(root, { profile: true });
    const recallPanel = new InteractiveBrowser(recallXrayBrowserOptions(recall));
    const diagnosticsPanel = new InteractiveBrowser(diagnosticsBrowserOptions(diagnostics));

    expect(firstFrame.length).toBeLessThan(40);
    expect(interactedFrame.length).toBeLessThan(60);
    expect(firstRenderMs).toBeLessThan(100);
    expect(interactionMs).toBeLessThan(250);
    expect(recall.profile?.spans.length).toBeGreaterThanOrEqual(5);
    expect(diagnostics.profile?.spans.length).toBeGreaterThanOrEqual(5);
    expect(recallPanel.render(120).join("\n")).toContain("Recall X-Ray Explorer");
    expect(diagnosticsPanel.render(120).join("\n")).toContain("Memory Doctor Dashboard");
    rmSync(root, { recursive: true, force: true });
  });
});
