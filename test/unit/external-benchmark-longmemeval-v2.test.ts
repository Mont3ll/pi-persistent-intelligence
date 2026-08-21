import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { longMemEvalV2Adapter, sanitizeLongMemEvalCase, validateLongMemEvalOutput } from "../../eval/external/benchmarks/longmemeval-v2";
import { manifest } from "./external-benchmark-manifest.test";

describe("LongMemEval-V2 adapter", () => {
  test("removes evaluator-only fields and keeps complete trajectories", () => {
    const source = { id: "00aa905a", domain: "web", question: "What happened?", answer: "gold", eval_function: "exact", gold_trajectory_ids: ["t1"], trajectories: [{ id: "t1", messages: [{ role: "assistant", content: "public history" }] }] };
    const result = sanitizeLongMemEvalCase(source); const text = JSON.stringify(result.value);
    expect(result.removedPaths.sort()).toEqual(["answer", "eval_function", "gold_trajectory_ids"]); expect(text).toContain("public history"); expect(text).not.toContain("gold");
  });
  test("uses official backend command and fixed question identifiers", () => {
    const command = longMemEvalV2Adapter.buildCommand({ ...manifest, benchmark: "longmemeval-v2", cases: ["00aa905a", "01307e07"] }, "/run").join(" ");
    expect(command).toContain("--question-ids 00aa905a,01307e07"); expect(command).toContain("--memory-type pi_persistent_intelligence"); expect(command).not.toContain("--limit");
  });
  test("validates per-question metrics and model identity", () => {
    const output = { metrics: { accuracy: 0.5 }, questions: [{ id: "00aa905a", contextTokens: 20, latencyMs: 4 }], models: { reader: "Qwen/Qwen3.5-9B", evaluator: "gpt-5.2" } };
    expect(() => validateLongMemEvalOutput(output, ["00aa905a"], ["Qwen/Qwen3.5-9B", "gpt-5.2"])).not.toThrow();
    expect(() => validateLongMemEvalOutput({ ...output, questions: [] }, ["00aa905a"], ["Qwen/Qwen3.5-9B", "gpt-5.2"])).toThrow("missing");
  });
  test("pins Small data inputs", () => {
    const config = JSON.parse(readFileSync("eval/external/configs/longmemeval-v2.json", "utf8")) as { datasetFiles: unknown[]; smokeCases: string[] };
    expect(config.datasetFiles).toHaveLength(3); expect(config.smokeCases).toEqual(["00aa905a", "01307e07"]);
  });
});
