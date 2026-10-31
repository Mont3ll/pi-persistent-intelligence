import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const cwd = join(import.meta.dir, "../..");
const script = join(cwd, "scripts/r4-pi-semantic-worker.ts");
const secret = "SYNTHETIC_PRIVATE_SENTINEL_R4_2026";

function invokeWorker(env: Record<string, string>, input: string) {
  return spawnSync(process.execPath, [script], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    input,
    timeout: 10_000,
    maxBuffer: 128 * 1024,
  });
}

describe("R4 Pi-hosted LLM evaluation worker (no model calls)", () => {
  test("missing explicit model selection abstains without disclosing original text", () => {
    const result = invokeWorker({
      PI_R4_PI_PROVIDER: "", PI_R4_PI_MODEL: "", PI_R4_PI_API_KEY: "",
    }, JSON.stringify({ source: { text: secret } }));
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("semantic_worker_unavailable");
    expect(result.stderr).not.toContain(secret);
  });

  test("missing dedicated credential does not inherit host-wide authentication", () => {
    const result = invokeWorker({
      PI_R4_PI_PROVIDER: "dummy", PI_R4_PI_MODEL: "dummy",
      PI_R4_PI_API_KEY: "",
    }, JSON.stringify({ source: { text: secret } }));
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain(secret);
  });

  test("invalid JSON never echoes source content to stderr", () => {
    const result = invokeWorker({
      PI_R4_PI_PROVIDER: "dummy", PI_R4_PI_MODEL: "dummy",
      PI_R4_PI_API_KEY: "synthetic-no-network-test",
    }, '{ "text": "' + secret + '", broken syntax }');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain(secret);
  });

  test("SDK runtime declaration disables tools, persistence and resource discovery", () => {
    const source = readFileSync(script, "utf8");
    for (const boundary of [
      'noTools: "all"', 'tools: []', 'customTools: []',
      "SessionManager.inMemory()", "SettingsManager.inMemory(",
      "noExtensions: true", "noSkills: true", "noPromptTemplates: true",
      "noThemes: true", "noContextFiles: true",
      "getActiveToolNames().length !== 0", "session?.dispose()",
      "setRuntimeApiKey(provider, apiKey)",
    ]) expect(source).toContain(boundary);
    expect(source).not.toContain("process.env.HOME");
  });
});
