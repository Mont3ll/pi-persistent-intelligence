import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBaseManifest, genericSanitizedCase, type ExternalBenchmarkAdapter } from "./adapter-support";
export type MemoryArenaCompatibilityStatus = "official_harness_unavailable" | "source_unpinned" | "ready";
export interface MemoryArenaCompatibility { status: MemoryArenaCompatibilityStatus; checks: Record<string, boolean>; sourceCommit?: string }
export function probeMemoryArena(sourceRoot: string, commit?: string): MemoryArenaCompatibility {
  if (!commit || !/^[a-f0-9]{40}$/.test(commit)) return { status: "source_unpinned", checks: {} };
  const required = { runner: "run_math.py", environment: "env/README.md", scoring: "env/env_systems/math_env.py", dataset: "run_math.py", models: "configs/formal_reasoning_configs/math_longcontext_gpt-5-mini.json", memoryInterface: "memory/client.py", ownership: "README.md" };
  const checks = Object.fromEntries(Object.entries(required).map(([name, path]) => [name, existsSync(join(sourceRoot, path))]));
  return { status: Object.values(checks).every(Boolean) ? "ready" : "official_harness_unavailable", checks, sourceCommit: commit };
}
export const memoryArenaAdapter: ExternalBenchmarkAdapter = {
  name: "memoryarena", prepare: async (input) => { if (input.preset !== "contract") { const config = JSON.parse(readFileSync(join(input.repoRoot, "eval/external/configs/memoryarena.json"), "utf8")) as { upstreamCommit: string }; const probe = probeMemoryArena(join(input.repoRoot, ".benchmark-cache/memoryarena"), config.upstreamCommit); if (probe.status !== "ready") throw new Error(probe.status); } return buildBaseManifest("memoryarena", input); },
  sanitizeCase: genericSanitizedCase,
  buildCommand: (_manifest, runDir) => ["python3", "eval/external/bridges/memoryarena_bridge.py", "--run", "--output", runDir],
  async verifyOfficialOutput(runDir) { const value = JSON.parse(readFileSync(join(runDir, "official-metrics.json"), "utf8")) as { values?: Record<string, number>; modelIds?: string[] }; if (!value.values || !value.modelIds) throw new Error("malformed MemoryArena official output"); return { values: value.values, modelIds: value.modelIds }; },
};
