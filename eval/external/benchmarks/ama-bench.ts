import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Text } from "../core/fingerprint";
import type { BenchmarkManifest } from "../core/types";
import { buildBaseManifest, type ExternalBenchmarkAdapter, type SanitizedCase } from "./adapter-support";

export function sanitizeAmaCase(value: unknown): SanitizedCase {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AMA-Bench case must be an object");
  const source = structuredClone(value as Record<string, unknown>); const caseId = String(source.episode_id ?? ""); if (!caseId) throw new Error("AMA-Bench case requires episode_id");
  const removedPaths: string[] = [];
  for (const key of ["qa_pairs", "success", "judge", "judge_result", "evaluation"]) if (key in source) { delete source[key]; removedPaths.push(key); }
  if (!Array.isArray(source.trajectory) || typeof source.task !== "string" || typeof source.domain !== "string") throw new Error("AMA-Bench case lacks trajectory, task, or domain");
  const sourceJson = JSON.stringify(value); const sanitizedJson = JSON.stringify(source);
  return { caseId, value: source, removedPaths, sourceHash: sha256Text(sourceJson), sanitizedHash: sha256Text(sanitizedJson) };
}
interface AmaOutput { episodes?: Array<{ episodeId?: string; questionId?: string; score?: number }>; metrics?: Record<string, number>; readerModel?: string; judgeModel?: string }
export function validateAmaOfficialOutput(value: unknown, caseIds: string[], modelIds: string[]): asserts value is AmaOutput {
  if (!value || typeof value !== "object") throw new Error("malformed AMA-Bench official output"); const output = value as AmaOutput;
  if (!Array.isArray(output.episodes) || !output.metrics || typeof output.readerModel !== "string" || typeof output.judgeModel !== "string") throw new Error("malformed AMA-Bench official output");
  if (!modelIds.includes(output.readerModel) || !modelIds.includes(output.judgeModel)) throw new Error("AMA-Bench model identity mismatch");
  const keys = new Set<string>(); const present = new Set<string>();
  for (const episode of output.episodes) { const episodeId = String(episode.episodeId ?? ""); const questionId = String(episode.questionId ?? ""); if (!episodeId || !questionId || typeof episode.score !== "number") throw new Error("malformed AMA-Bench episode output"); const key = `${episodeId}:${questionId}`; if (keys.has(key)) throw new Error("duplicate AMA-Bench episode/question pair"); keys.add(key); present.add(episodeId); }
  for (const id of caseIds) if (!present.has(id)) throw new Error(`missing AMA-Bench episode ${id}`);
}
export const amaBenchAdapter: ExternalBenchmarkAdapter = {
  name: "ama-bench", prepare: (input) => buildBaseManifest("ama-bench", input), sanitizeCase: sanitizeAmaCase,
  buildCommand: (manifest, runDir) => ["python3", "eval/external/bridges/ama_bench_bridge.py", "--source-root", ".benchmark-cache/ama-bench", "--dataset-file", ".benchmark-cache/datasets/ama/open_end_qa_set.jsonl", "--output", runDir, "--reader-config", ".benchmark-cache/ama-bench/configs/openai_gpt5_mini.yaml", "--judge-config", ".benchmark-cache/ama-bench/configs/llm_judge_gpt5_mini.yaml", "--episode-ids", manifest.cases.join(","), "--track", manifest.tracks.join(","), "--bridge-worker", "bun eval/external/bridge-worker.ts", "--pi-commit", manifest.pi.commit],
  async verifyOfficialOutput(runDir: string, manifest: BenchmarkManifest) { const value = JSON.parse(readFileSync(join(runDir, "official-output.json"), "utf8")); const modelIds = manifest.models.map((model) => model.id); validateAmaOfficialOutput(value, manifest.cases, modelIds); return { values: (value as AmaOutput).metrics!, modelIds: [(value as AmaOutput).readerModel!, (value as AmaOutput).judgeModel!] }; },
};
