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
  datasetFiles: Array<{ path: string; sha256: string }>;
  models: Array<{ role: ModelRole; id: string; provider: string; baseUrl?: string }>; estimatedCostPerCaseUsd: number | null;
}
export function loadAdapterConfig(repoRoot: string, name: BenchmarkName): AdapterConfig { return JSON.parse(readFileSync(join(repoRoot, "eval", "external", "configs", `${name}.json`), "utf8")) as AdapterConfig; }
function git(repoRoot: string, args: string[]): string { const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" }); if (result.status !== 0) throw new Error(String(result.stderr).trim() || "git command failed"); return String(result.stdout).trim(); }
export async function buildBaseManifest(name: BenchmarkName, input: PrepareInput): Promise<BenchmarkManifest> {
  const config = loadAdapterConfig(input.repoRoot, name); const commit = git(input.repoRoot, ["rev-parse", "HEAD"]); const status = git(input.repoRoot, ["status", "--porcelain", "--untracked-files=no"]); const diff = git(input.repoRoot, ["diff", "--binary", "HEAD"]);
  const contract = input.preset === "contract"; const fixture = join(input.repoRoot, "eval", "external", "fixtures", "synthetic-cases.jsonl");
  if (input.preset === "pilot" || input.preset === "full") throw new Error(`${name} ${input.preset} case selection is not configured; preparation fails closed`);
  const models = contract
    ? [{ role: "reader" as const, id: "fake-reader", provider: "local" }, { role: "judge" as const, id: "fake-judge", provider: "local" }]
    : config.models;
  const cases = contract ? ["synthetic-1"] : config.smokeCases;
  const dataset = contract
    ? { url: "repository:eval/external/fixtures", revision: commit, files: [{ path: "eval/external/fixtures/synthetic-cases.jsonl", sha256: await sha256File(fixture) }] }
    : { url: config.datasetUrl, revision: config.datasetRevision, files: config.datasetFiles };
  const estimatedCostUsd = contract || config.estimatedCostPerCaseUsd === 0 ? 0 : config.estimatedCostPerCaseUsd === null ? null : config.estimatedCostPerCaseUsd * cases.length * input.tracks.length;
  return {
    schemaVersion: 1, benchmark: name, preset: input.preset, tracks: input.tracks,
    pi: { commit, clean: status === "", sourceHash: sha256Text(`${commit}\n${diff}`) },
    upstream: { url: config.upstreamUrl, commit: config.upstreamCommit }, dataset, cases, models,
    promptHashes: Object.fromEntries(models.map((model) => [model.role, sha256Text(`${name}:${model.role}:${model.id}:v1`)])),
    context: { maxTokens: 14000, maxRecords: 12 }, curationPolicy: "pi-default-high-only-v1", seeds: [0], retry: { maxAttempts: contract ? 1 : 2, baseDelayMs: contract ? 0 : 1000 },
    environment: { bun: Bun.version, python: "3.11", platform: `${process.platform}-${process.arch}` },
    expected: { cases: cases.length, modelCalls: contract ? 0 : cases.length * input.tracks.length * models.filter((model) => model.role === "reader" || model.role === "judge" || model.role === "controller").length, estimatedCostUsd }, outputRoot: "reports/benchmarks/runs",
  };
}
export function genericSanitizedCase(value: unknown): SanitizedCase {
  const source = JSON.stringify(value); const object = value && typeof value === "object" ? structuredClone(value as Record<string, unknown>) : { value };
  return { caseId: typeof object.caseId === "string" ? object.caseId : "unknown", value: object, removedPaths: [], sourceHash: sha256Text(source), sanitizedHash: sha256Text(JSON.stringify(object)) };
}
