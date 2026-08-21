import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBaseManifest, genericSanitizedCase, type ExternalBenchmarkAdapter } from "./adapter-support";
export const longMemEvalV2Adapter: ExternalBenchmarkAdapter = {
  name: "longmemeval-v2", prepare: (input) => buildBaseManifest("longmemeval-v2", input), sanitizeCase: genericSanitizedCase,
  buildCommand: (manifest, runDir) => ["python3", "eval/external/bridges/longmemeval_v2_bridge.py", "--manifest", join(runDir, "manifest.json"), "--output", runDir, "--case-ids", manifest.cases.join(",")],
  async verifyOfficialOutput(runDir) { const value = JSON.parse(readFileSync(join(runDir, "official-metrics.json"), "utf8")) as { values?: Record<string, number>; modelIds?: string[] }; if (!value.values || !value.modelIds) throw new Error("malformed LongMemEval-V2 official output"); return { values: value.values, modelIds: value.modelIds }; },
};
