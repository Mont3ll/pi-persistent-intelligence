import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkManifest } from "../core/types";
import { buildBaseManifest, genericSanitizedCase, type ExternalBenchmarkAdapter } from "./adapter-support";

export const amaBenchAdapter: ExternalBenchmarkAdapter = {
  name: "ama-bench",
  prepare: (input) => buildBaseManifest("ama-bench", input),
  sanitizeCase: genericSanitizedCase,
  buildCommand: (manifest, runDir) => ["python3", "eval/external/bridges/ama_bench_bridge.py", "--manifest", join(runDir, "manifest.json"), "--output", runDir, "--case-ids", manifest.cases.join(",")],
  async verifyOfficialOutput(runDir: string, manifest: BenchmarkManifest) { const value = JSON.parse(readFileSync(join(runDir, "official-metrics.json"), "utf8")) as { values?: Record<string, number>; modelIds?: string[] }; if (!value.values || !value.modelIds || !manifest.cases.length) throw new Error("malformed AMA-Bench official output"); return { values: value.values, modelIds: value.modelIds }; },
};
