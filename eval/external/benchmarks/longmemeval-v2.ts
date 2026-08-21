import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Text } from "../core/fingerprint";
import type { BenchmarkManifest } from "../core/types";
import { buildBaseManifest, type ExternalBenchmarkAdapter, type SanitizedCase } from "./adapter-support";

export function sanitizeLongMemEvalCase(value: unknown): SanitizedCase {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("LongMemEval-V2 case must be an object");
  const source = structuredClone(value as Record<string, unknown>); const caseId = String(source.id ?? ""); if (!caseId) throw new Error("LongMemEval-V2 case requires id"); const removedPaths: string[] = [];
  for (const key of ["answer", "eval_function", "gold_trajectory_ids", "gold_evidence", "reference_answer", "evaluator_notes"]) if (key in source) { delete source[key]; removedPaths.push(key); }
  if (typeof source.question !== "string") throw new Error("LongMemEval-V2 case requires question");
  const sourceJson = JSON.stringify(value); const sanitized = JSON.stringify(source);
  return { caseId, value: source, removedPaths, sourceHash: sha256Text(sourceJson), sanitizedHash: sha256Text(sanitized) };
}
interface LongMemEvalOutput { metrics?: Record<string, number>; questions?: Array<{ id?: string; contextTokens?: number; latencyMs?: number }>; models?: { reader?: string; evaluator?: string } }
export function validateLongMemEvalOutput(value: unknown, caseIds: string[], modelIds: string[]): asserts value is LongMemEvalOutput {
  if (!value || typeof value !== "object") throw new Error("malformed LongMemEval-V2 output"); const output = value as LongMemEvalOutput;
  if (!output.metrics || !Array.isArray(output.questions) || !output.models?.reader || !output.models.evaluator) throw new Error("malformed LongMemEval-V2 output");
  if (!modelIds.includes(output.models.reader) || !modelIds.includes(output.models.evaluator)) throw new Error("LongMemEval-V2 model identity mismatch");
  const seen = new Set<string>(); for (const question of output.questions) { if (!question.id || typeof question.contextTokens !== "number" || typeof question.latencyMs !== "number") throw new Error("malformed LongMemEval-V2 question output"); if (seen.has(question.id)) throw new Error("duplicate LongMemEval-V2 question output"); seen.add(question.id); }
  for (const id of caseIds) if (!seen.has(id)) throw new Error(`missing LongMemEval-V2 question ${id}`);
}
export const longMemEvalV2Adapter: ExternalBenchmarkAdapter = {
  name: "longmemeval-v2", prepare: (input) => buildBaseManifest("longmemeval-v2", input), sanitizeCase: sanitizeLongMemEvalCase,
  buildCommand: (manifest, runDir) => ["python3", "eval/external/bridges/longmemeval_v2_bridge.py", "--source-root", ".benchmark-cache/longmemeval-v2", "--data-root", ".benchmark-cache/datasets/lme", "--output", runDir, "--tier", "small", "--domain", "both", "--memory-type", "pi_persistent_intelligence", "--question-ids", manifest.cases.join(","), "--track", manifest.tracks.join(","), "--bridge-worker", "bun eval/external/bridge-worker.ts"],
  async verifyOfficialOutput(runDir: string, manifest: BenchmarkManifest) { const value = JSON.parse(readFileSync(join(runDir, "official-output.json"), "utf8")); validateLongMemEvalOutput(value, manifest.cases, manifest.models.map((model) => model.id)); const output = value as LongMemEvalOutput; return { values: output.metrics!, modelIds: [output.models!.reader!, output.models!.evaluator!] }; },
};
