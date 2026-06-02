import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { buildRetrievalContext } from "../../src/retriever";
import { runMemoryDiagnostics, renderDiagnosticsReport } from "../../src/diagnostics";

describe("token diagnostics", () => {
  test("reports last injection mode and character count", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-token-diag-"));
    ensureMemoryDirs(root);
    writeFileSync(join(root, "config.json"), JSON.stringify({ retrieval: { injectionMode: "wakeup" } }));
    const ctx = await buildRetrievalContext(root, { prompt: "Start task", today: "2026-06-01", cwd: root });
    const report = runMemoryDiagnostics(root);
    const rendered = renderDiagnosticsReport(report);
    expect(report.findings.some((f) => f.code === "last_injection_stats" && f.message.includes("wakeup"))).toBe(true);
    expect(rendered).toContain(String(ctx.markdown.length));
    rmSync(root, { recursive: true, force: true });
  });
});
