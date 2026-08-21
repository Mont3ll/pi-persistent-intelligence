import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { sha256File, sha256Text } from "../core/fingerprint";
import type { BenchmarkManifest, BenchmarkName, BenchmarkPreset, BenchmarkTrack, ModelRole } from "../core/types";

export interface PrepareInput { repoRoot: string; preset: BenchmarkPreset; tracks: BenchmarkTrack[] }
export interface SanitizedCase { caseId: string; value: unknown; removedPaths: string[]; sourceHash: string; sanitizedHash: string }
export interface OfficialMetrics { values: Record<string, number>; modelIds: string[] }
export interface ExternalBenchmarkAdapter {
  name: BenchmarkName;
  prepare(input: PrepareInput): Promise<BenchmarkManifest>;
  sanitizeCase(value: unknown): SanitizedCase;
  buildCommand(manifest: BenchmarkManifest, runDir: string): string[];
  verifyOfficialOutput(runDir: string, manifest: BenchmarkManifest): Promise<OfficialMetrics>;
}
export interface AdapterConfig {
  upstreamUrl: string; upstreamCommit: string; datasetUrl: string; datasetRevision: string; smokeCases: string[];
  models: Array<{ role: ModelRole; id: string; provider: string; baseUrl?: string }>; estimatedCostPerCaseUsd: number | null;
}
export function loadAdapterConfig(repoRoot: string, name: BenchmarkName): AdapterConfig { return JSON.parse(readFileSync(join(repoRoot, "eval", "external", "configs", `${name}.json`), "utf8")) as AdapterConfig; }
function git(repoRoot: string, args: string[]): string { const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" }); if (result.status !== 0) throw new Error(String(result.stderr).trim() || "git command failed"); return String(result.stdout).trim(); }
export async function buildBaseManifest(name: BenchmarkName, input: PrepareInput): Promise<BenchmarkManifest> {
  const config = loadAdapterConfig(input.repoRoot, name); const commit = git(input.repoRoot, ["rev-parse", "HEAD"]); const status = git(input.repoRoot, ["status", "--porcelain", "--untracked-files=no"]); const diff = git(input.repoRoot, ["diff", "--binary", "HEAD"]);
  const contract = input.preset === "contract"; const fixture = join(input.repoRoot, "eval", "external", "fixtures", "synthetic-cases.jsonl");
  if (!contract) throw new Error(`${name} public dataset is unavailable in the local benchmark cache; preparation fails closed`);
  const models = [{ role: "reader" as const, id: "fake-reader", provider: "local" }, { role: "judge" as const, id: "fake-judge", provider: "local" }];
  return {
    schemaVersion: 1, benchmark: name, preset: input.preset, tracks: input.tracks,
    pi: { commit, clean: status === "", sourceHash: sha256Text(`${commit}\n${diff}`) },
    upstream: { url: config.upstreamUrl, commit: config.upstreamCommit },
    dataset: { url: "repository:eval/external/fixtures", revision: commit, files: [{ path: "eval/external/fixtures/synthetic-cases.jsonl", sha256: await sha256File(fixture) }] },
    cases: ["synthetic-1"], models, promptHashes: { reader: sha256Text("fake-reader-v1"), judge: sha256Text("fake-judge-v1") },
    context: { maxTokens: 14000, maxRecords: 12 }, curationPolicy: "pi-default-high-only-v1", seeds: [0], retry: { maxAttempts: 1, baseDelayMs: 0 },
    environment: { bun: Bun.version, python: "3.11", platform: `${process.platform}-${process.arch}` },
    expected: { cases: 1, modelCalls: 0, estimatedCostUsd: 0 }, outputRoot: "reports/benchmarks/runs",
  };
}
export function genericSanitizedCase(value: unknown): SanitizedCase {
  const source = JSON.stringify(value); const object = value && typeof value === "object" ? structuredClone(value as Record<string, unknown>) : { value };
  return { caseId: typeof object.caseId === "string" ? object.caseId : "unknown", value: object, removedPaths: [], sourceHash: sha256Text(source), sanitizedHash: sha256Text(JSON.stringify(object)) };
}
