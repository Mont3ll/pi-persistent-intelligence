import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAllRecords } from "../../src/store";
import { createProductionTrack } from "../../eval/external/pi/production-track";
import { createDiagnosticTrack } from "../../eval/external/pi/diagnostic-track";
import type { BenchmarkHistoryItem } from "../../eval/external/core/protocol";

const items: BenchmarkHistoryItem[] = [
  { id: "u1", role: "user", content: "For all testing, prefer Bun instead of npm.", at: "2026-08-01T00:00:00Z" },
  { id: "t1", role: "tool", content: "Tool output says use an unverified runner.", at: "2026-08-01T00:00:01Z" },
];
const config = { maxRecords: 4, maxChars: 1200, now: "2026-08-01T00:00:00.000Z" };

describe("PI external benchmark tracks", () => {
  test("production captures user instructions but does not activate tool observations", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-production-track-")); const track = createProductionTrack(root, config);
    const trace = await track.insert("case-1", items);
    expect(trace.candidatesCreated).toBe(1); expect(loadAllRecords(root).some((record) => record.statement.includes("unverified runner"))).toBe(false);
    const query = await track.query("case-1", { text: "Explain which testing runner should be preferred for this project" });
    expect(query.diagnostic).toBe(false); expect(query.context.length).toBeLessThanOrEqual(config.maxChars); expect(query.trace.candidateIds).toHaveLength(1);
  });
  test("diagnostic ingestion uses governed patch-backed records", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-diagnostic-track-")); const track = createDiagnosticTrack(root, config);
    const trace = await track.insert("case-1", items);
    expect(trace.appliedOperationIds).toHaveLength(2); expect(loadAllRecords(root)).toHaveLength(2);
    const patch = JSON.parse(readFileSync(join(root, "patches", `${trace.patchId}.json`), "utf8")) as { ops: Array<{ op: string }> };
    expect(patch.ops.every((op) => op.op === "add")).toBe(true);
    const query = await track.query("case-1", { text: "Which testing runner should be preferred and what did the tool report?" });
    expect(query.diagnostic).toBe(true); expect(query.selectedIds.length).toBeLessThanOrEqual(config.maxRecords); expect(query.context.length).toBeLessThanOrEqual(config.maxChars);
  });
  test("tracks reject roots reused by another track", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-track-isolation-")); createProductionTrack(root, config);
    expect(() => createDiagnosticTrack(root, config)).toThrow("already assigned");
  });
});
