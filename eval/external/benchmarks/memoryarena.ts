import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkPreset } from "../core/types";
import { buildBaseManifest, genericSanitizedCase, type ExternalBenchmarkAdapter } from "./adapter-support";
export type MemoryArenaCompatibilityStatus = "official_harness_unavailable" | "source_unpinned" | "pi_adapter_unavailable" | "ready";
export interface MemoryArenaCompatibility { status: MemoryArenaCompatibilityStatus; checks: Record<string, boolean>; sourceCommit?: string }
export function probeMemoryArena(sourceRoot: string, commit?: string, piAdapterReady = false): MemoryArenaCompatibility {
  if (!commit || !/^[a-f0-9]{40}$/.test(commit)) return { status: "source_unpinned", checks: {} };
  const required = {
    officialRepository: "README.md", runnerEntrypoint: "run_math.py", environmentSpecification: "env/README.md",
    scoringImplementation: "env/env_systems/math_env.py", datasetBinding: "run_math.py",
    modelConfiguration: "configs/formal_reasoning_configs/math_longcontext_gpt-5-mini.json", memoryInterface: "memory/client.py",
  };
  const checks = Object.fromEntries(Object.entries(required).map(([name, path]) => [name, existsSync(join(sourceRoot, path))]));
  if (!Object.values(checks).every(Boolean)) return { status: "official_harness_unavailable", checks, sourceCommit: commit };
  return { status: piAdapterReady ? "ready" : "pi_adapter_unavailable", checks: { ...checks, piAdapter: piAdapterReady }, sourceCommit: commit };
}
export function assertMemoryArenaRunnable(compatibility: MemoryArenaCompatibility, preset: BenchmarkPreset): void {
  if (preset === "contract") return;
  if (compatibility.status !== "ready") throw new Error(compatibility.status);
}
export const memoryArenaAdapter: ExternalBenchmarkAdapter = {
  name: "memoryarena",
  prepare: async (input) => {
    if (input.preset !== "contract") {
      const config = JSON.parse(readFileSync(join(input.repoRoot, "eval/external/configs/memoryarena.json"), "utf8")) as { upstreamCommit: string };
      assertMemoryArenaRunnable(probeMemoryArena(join(input.repoRoot, ".benchmark-cache/memoryarena"), config.upstreamCommit), input.preset);
    }
    return buildBaseManifest("memoryarena", input);
  },
  sanitizeCase: genericSanitizedCase,
  buildCommand: (_manifest, runDir) => ["python3", "eval/external/bridges/memoryarena_bridge.py", "--run", "--output", runDir],
  async verifyOfficialOutput() { throw new Error("pi_adapter_unavailable"); },
};
