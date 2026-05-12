import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLlmAssistRequest, runConfiguredLlmAssist } from "../../src/llmAssist";
import type { CaptureCandidate } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-pi-llm-cmd-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function candidate(): CaptureCandidate { return { id: "cap_1", created_at: "2026-05-09T00:00:00Z", source: { type: "manual", ref: "daily" }, text: "Use patches for memory", tags: ["memory"], evidence_refs: ["daily"], confidence: 0.8, status: "new" }; }

describe("LLM assist command adapter", () => {
  test("builds structured request without invoking a model", () => {
    const request = buildLlmAssistRequest({ task: "curate", candidates: [candidate()], records: [] });
    expect(request.task).toBe("curate");
    expect(request.instructions).toContain("Return JSON");
  });

  test("runs explicit configured command", async () => {
    const dir = root();
    const script = join(dir, "echo-json.js");
    writeFileSync(script, "process.stdin.on('data', d => { const x = JSON.parse(String(d)); console.log(JSON.stringify({ ok: true, task: x.task })); });", "utf-8");
    const result = await runConfiguredLlmAssist({ enabled: true, model: "external", command: `node ${script}` }, { task: "maintain", candidates: [], records: [] });
    expect(result).toEqual({ ok: true, task: "maintain" });
  });
});
