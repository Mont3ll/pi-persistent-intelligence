import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord as addMemoryRecord } from "../../src/store";
import { buildRetrievalContext } from "../../src/retriever";
import type { MemoryRecord } from "../../src/types";

let roots: string[] = [];
afterEach(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); roots = []; });
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-stress-100-")); roots.push(dir); ensureMemoryDirs(dir); return dir; }
function rec(id: string, layer: "L1" | "L2", statement: string): MemoryRecord { return { id, layer, scope: { type: "global" }, tags: ["stress", "retrieval"], statement, evidence: [{ type: "manual", ref: "stress", note: "stress" }], confidence: 0.9, stability: "stable", created_at: "2026-01-01", updated_at: "2026-01-01", review: { cadence_days: 30, next_review: "2026-12-01", change_condition: "stress" }, status: "active", supersedes: [], superseded_by: [], vault_ref: null }; }

describe("retrieval stress 100 records", () => {
  test("builds context under local target and includes relevant L2", async () => {
    const r = root();
    for (let i = 0; i < 10; i++) addMemoryRecord(r, rec(`l1_${i}`, "L1", `identity ${i}`));
    for (let i = 0; i < 90; i++) addMemoryRecord(r, rec(`l2_${i}`, "L2", i < 5 ? `relevant qmd retrieval ${i}` : `unrelated graphics ${i}`));
    const start = performance.now();
    const context = await buildRetrievalContext(r, { prompt: "qmd retrieval stress target", today: "2026-06-15", useQmd: false, maxTotalChars: 14_000 });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(context.selectedMemory.some((record) => record.id.startsWith("l2_"))).toBe(true);
    expect(context.markdown.length).toBeLessThanOrEqual(14_200);
  });
});
