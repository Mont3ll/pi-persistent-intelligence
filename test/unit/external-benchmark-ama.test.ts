import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { amaBenchAdapter, sanitizeAmaCase, validateAmaOfficialOutput } from "../../eval/external/benchmarks/ama-bench";
import { manifest } from "./external-benchmark-manifest.test";

describe("AMA-Bench adapter", () => {
  test("removes evaluator fields while preserving software trajectory", () => {
    const source = { episode_id: 141, task: "repair package", task_type: "swebench", domain: "SOFTWARE", success: true, trajectory: [{ turn_idx: 0, action: "edit", observation: "changed source" }], qa_pairs: [{ question: "what?", answer: "gold", type: "A", question_uuid: "q1" }], judge: { score: 1 } };
    const result = sanitizeAmaCase(source);
    expect(result.caseId).toBe("141"); expect(result.removedPaths.sort()).toEqual(["judge", "qa_pairs", "success"]);
    expect(JSON.stringify(result.value)).toContain("changed source"); expect(JSON.stringify(result.value)).not.toContain("gold");
  });
  test("builds fixed-case official runner command", () => {
    const command = amaBenchAdapter.buildCommand({ ...manifest, cases: ["141"] }, "/run");
    expect(command.join(" ")).toContain("--episode-ids 141"); expect(command.join(" ")).not.toContain("--samples"); expect(command.join(" ")).toContain("--source-root");
  });
  test("validates complete output and model identities", () => {
    expect(() => validateAmaOfficialOutput({ episodes: [{ episodeId: "141", questionId: "q1", score: 1 }], metrics: { accuracy: 1 }, readerModel: "gpt-5-mini", judgeModel: "gpt-5-mini" }, ["141"], ["gpt-5-mini"])).not.toThrow();
    expect(() => validateAmaOfficialOutput({ episodes: [], metrics: {}, readerModel: "other", judgeModel: "other" }, ["141"], ["gpt-5-mini"])).toThrow();
  });
  test("pins the reviewed source and dataset revisions", () => {
    const config = JSON.parse(readFileSync("eval/external/configs/ama-bench.json", "utf8")) as { upstreamCommit: string; datasetRevision: string; smokeCases: string[] };
    expect(config.upstreamCommit).toHaveLength(40); expect(config.datasetRevision).toHaveLength(40); expect(config.smokeCases).toEqual(["141"]);
  });
});
