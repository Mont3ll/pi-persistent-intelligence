import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCaptureQualityReport, renderCaptureQualityReport } from "../../src/capture-quality";
import { processCaptureTurn } from "../../src/capture-coordinator";
import type { ProjectIdentity } from "../../src/types";

const dirs: string[] = [];
function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-capture-quality-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });
const resolver = (): ProjectIdentity => ({ project_id: "repo", source: "package_name", package_name: "repo" });

describe("capture quality", () => {
  test("reports capture funnel, reasons, scopes, and bytes without raw messages", () => {
    const dir = root();
    processCaptureTurn(dir, { session_id: "s1", turn_id: "t1", message: "Avoid em dashes in my public writing.", launch_cwd: "/repo", actions: [], resolver, now: "2026-07-26T00:00:00Z" });
    processCaptureTurn(dir, { session_id: "s1", turn_id: "t2", message: "This is ordinary conversation without a durable rule.", launch_cwd: "/repo", actions: [], resolver, now: "2026-07-26T00:01:00Z" });
    processCaptureTurn(dir, { session_id: "s1", turn_id: "t3", message: "Always use OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 for release.", launch_cwd: "/repo", actions: [], resolver, now: "2026-07-26T00:02:00Z" });
    const report = buildCaptureQualityReport(dir, { now: "2026-07-26T01:00:00Z" });
    expect(report.messages_evaluated).toBe(3);
    expect(report.funnel.candidate_created).toBe(1);
    expect(report.funnel.rejected).toBe(2);
    expect(report.rejection_reasons.no_durable_intent).toBe(1);
    expect(report.rejection_reasons.secret_detected).toBe(1);
    expect(report.scope_distribution.global).toBe(1);
    expect(report.runtime_bytes).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz");
    expect(renderCaptureQualityReport(report)).toContain("Messages evaluated: 3");
  });
});
