import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertMemoryArenaRunnable, probeMemoryArena } from "../../eval/external/benchmarks/memoryarena";
import { runProcess } from "../../eval/external/core/process";

function harness(root: string): void { for (const path of ["run_math.py", "env/README.md", "env/env_systems/math_env.py", "configs/formal_reasoning_configs/math_longcontext_gpt-5-mini.json", "memory/client.py", "README.md"]) { const file = join(root, path); mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, "public"); } }
describe("MemoryArena compatibility gate", () => {
  test("distinguishes absent, unpinned, integration-pending, and ready states", () => {
    const missing = mkdtempSync(join(tmpdir(), "memoryarena-missing-"));
    expect(probeMemoryArena(missing, "a".repeat(40)).status).toBe("official_harness_unavailable");
    expect(probeMemoryArena(missing).status).toBe("source_unpinned");
    const source = mkdtempSync(join(tmpdir(), "memoryarena-source-")); harness(source);
    expect(probeMemoryArena(source, "a".repeat(40)).status).toBe("pi_adapter_unavailable");
    expect(probeMemoryArena(source, "a".repeat(40), true).status).toBe("ready");
  });
  test("only contract preparation is allowed while PI integration is pending", () => {
    const compatibility = { status: "pi_adapter_unavailable" as const, checks: { runner: true }, sourceCommit: "a".repeat(40) };
    expect(() => assertMemoryArenaRunnable(compatibility, "smoke")).toThrow("pi_adapter_unavailable");
    expect(() => assertMemoryArenaRunnable(compatibility, "contract")).not.toThrow();
  });
  test("bridge fails closed for execution and exposes structured probe", async () => {
    const source = mkdtempSync(join(tmpdir(), "memoryarena-bridge-source-")); harness(source);
    const probe = await runProcess(["python3", "eval/external/bridges/memoryarena_bridge.py", "--probe", "--source-root", source, "--commit", "6cd9de14b71915e39ac742a20dc33785e14b6aab"], { timeoutMs: 10_000 });
    expect(probe.code).toBe(0); expect(JSON.parse(probe.stdout).status).toBe("pi_adapter_unavailable");
    const run = await runProcess(["python3", "eval/external/bridges/memoryarena_bridge.py", "--run"], { timeoutMs: 10_000 });
    expect(run.code).toBe(2); expect(run.stderr).toContain("pi_adapter_unavailable");
  });
});
