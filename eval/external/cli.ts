#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { defaultRoot } from "../../src/paths";
import { appendJsonlAtomic, writeJsonAtomic } from "./core/artifacts";
import { fingerprintManifest } from "./core/fingerprint";
import { readApproval, readManifest, validateApproval, writeApproval, writeManifest } from "./core/manifest";
import { assertBenchmarkRootIsolated } from "./core/paths";
import { renderPublicMarkdown, renderPublicReport, verifyBenchmarkRun } from "./core/report";
import { createDiagnosticTrack } from "./pi/diagnostic-track";
import { createProductionTrack } from "./pi/production-track";
import type { BenchmarkHistoryItem, BenchmarkQuery } from "./core/protocol";
import type { BenchmarkManifest, BenchmarkName, BenchmarkPreset, BenchmarkTrack } from "./core/types";
import { getBenchmarkAdapter } from "./benchmarks/registry";

const COMMANDS = new Set(["prepare", "approve", "run", "resume", "verify", "report"]);
export interface ParsedCli { command: string; options: Record<string, string | boolean> }
export interface PrepareBenchmarkInput { repoRoot: string; benchmark: BenchmarkName; preset: BenchmarkPreset; tracks: BenchmarkTrack[]; outputRoot?: string }
export interface RunContractInput { repoRoot: string; manifestPath: string; approvalPath: string; runsRoot?: string; liveRoot?: string }
export function parseCli(argv: string[]): ParsedCli {
  const [command, ...rest] = argv; if (!command || command === "--help") return { command: "help", options: {} }; if (!COMMANDS.has(command)) throw new Error(`unknown benchmark command: ${command}`);
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index++) { const token = rest[index]; if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`); const key = token.slice(2); const next = rest[index + 1]; if (!next || next.startsWith("--")) options[key] = true; else { options[key] = next; index++; } }
  return { command, options };
}
export function expandTracks(value: string): BenchmarkTrack[] { if (value === "both") return ["production", "diagnostic"]; if (value === "production" || value === "diagnostic") return [value]; throw new Error(`invalid benchmark track: ${value}`); }
export function assertApprovalAllowed(manifest: BenchmarkManifest): void {
  if (manifest.preset !== "contract" && manifest.expected.estimatedCostUsd === null) throw new Error("public benchmark approval is blocked because the manifest has an unknown estimated cost");
}
export function requireRunnableManifest(manifest: BenchmarkManifest, approvedFingerprint?: string): string {
  if (manifest.preset !== "contract" && !manifest.pi.clean) throw new Error("public benchmark runs require a clean worktree");
  if (!approvedFingerprint) throw new Error("benchmark run requires explicit approval");
  if (!/^[a-f0-9]{64}$/.test(approvedFingerprint)) throw new Error("approval requires the full 64-character fingerprint");
  const current = fingerprintManifest(manifest); if (approvedFingerprint !== current) throw new Error("approval fingerprint mismatch"); return current;
}
export async function prepareBenchmark(input: PrepareBenchmarkInput): Promise<{ manifest: BenchmarkManifest; fingerprint: string; path: string }> {
  const manifest = await getBenchmarkAdapter(input.benchmark).prepare({ repoRoot: input.repoRoot, preset: input.preset, tracks: input.tracks });
  const fingerprint = fingerprintManifest(manifest); const output = input.outputRoot ?? join(input.repoRoot, "reports", "benchmarks", "manifests"); mkdirSync(output, { recursive: true });
  const path = join(output, `${input.benchmark}-${input.preset}-${fingerprint}.json`); writeManifest(path, manifest); return { manifest, fingerprint, path };
}
interface SyntheticCase { caseId: string; history: BenchmarkHistoryItem[]; query: BenchmarkQuery }
export async function runContractBenchmark(input: RunContractInput): Promise<string> {
  const manifest = readManifest(input.manifestPath); if (manifest.preset !== "contract") throw new Error("network-free runner accepts contract manifests only");
  const approval = readApproval(input.approvalPath); const fingerprint = requireRunnableManifest(manifest, approval.manifestFingerprint); validateApproval(approval, fingerprint);
  const runDir = join(input.runsRoot ?? join(input.repoRoot, "reports", "benchmarks", "runs"), fingerprint); mkdirSync(runDir, { recursive: true });
  writeManifest(join(runDir, "manifest.json"), manifest); writeApproval(join(runDir, "approval.json"), fingerprint, approval.approvedAt);
  const cases = readFileSync(join(input.repoRoot, "eval", "external", "fixtures", "synthetic-cases.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as SyntheticCase).filter((item) => manifest.cases.includes(item.caseId));
  if (cases.length !== manifest.cases.length) throw new Error("contract fixture does not contain every selected case");
  const results: Array<{ caseId: string; track: BenchmarkTrack; diagnostic: boolean; latencyMs: number; contextChars: number }> = []; const scores: Record<string, number[]> = { production: [], diagnostic: [] };
  for (const fixture of cases) for (const trackName of manifest.tracks) {
    const caseRoot = join(runDir, "cases", fixture.caseId, trackName, "pi-root"); assertBenchmarkRootIsolated(caseRoot, input.liveRoot ?? defaultRoot()); mkdirSync(caseRoot, { recursive: true });
    const statePath = join(runDir, "state.jsonl"); const state = (stage: string) => appendJsonlAtomic(statePath, { caseId: fixture.caseId, track: trackName, stage, attempt: 1, at: "2000-01-01T00:00:00.000Z" }); state("planned"); state("running");
    const runner = trackName === "production" ? createProductionTrack(caseRoot, { maxRecords: manifest.context.maxRecords, maxChars: manifest.context.maxTokens * 4, now: "2000-01-01T00:00:00.000Z" }) : createDiagnosticTrack(caseRoot, { maxRecords: manifest.context.maxRecords, maxChars: manifest.context.maxTokens * 4, now: "2000-01-01T00:00:00.000Z" });
    await runner.insert(fixture.caseId, fixture.history); const started = performance.now(); const answer = await runner.query(fixture.caseId, fixture.query); const latencyMs = Math.max(0, performance.now() - started); state("answered");
    scores[trackName].push(/\bbun\b/i.test(answer.context) ? 1 : 0); state("evaluated"); results.push({ caseId: fixture.caseId, track: trackName, diagnostic: answer.diagnostic, latencyMs, contextChars: answer.context.length }); state("verified"); await runner.close(fixture.caseId);
  }
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  writeJsonAtomic(join(runDir, "run.json"), { manifestFingerprint: fingerprint, status: "contract", models: manifest.models.map((model) => model.id), officialMetrics: { productionExactMatch: average(scores.production), diagnosticExactMatch: average(scores.diagnostic) }, results });
  return runDir;
}
function value(options: Record<string, string | boolean>, key: string): string { const found = options[key]; if (typeof found !== "string" || !found) throw new Error(`--${key} is required`); return found; }
function help(): string { return ["External benchmark commands:", "  prepare --benchmark <name> --preset <contract|smoke|pilot|full> --track <production|diagnostic|both>", "  approve --manifest <path> --fingerprint <64-char sha256>", "  run --manifest <path>", "  resume --run <directory>", "  verify --run <directory>", "  report --run <directory>"].join("\n"); }
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseCli(argv); if (parsed.command === "help" || parsed.options.help) { console.log(help()); return; }
  const repoRoot = resolve(import.meta.dir, "../..");
  if (parsed.command === "prepare") { const benchmark = value(parsed.options, "benchmark") as BenchmarkName; const preset = value(parsed.options, "preset") as BenchmarkPreset; const tracks = expandTracks(value(parsed.options, "track")); const prepared = await prepareBenchmark({ repoRoot, benchmark, preset, tracks }); console.log(JSON.stringify({ manifest: prepared.path, fingerprint: prepared.fingerprint, expectedCalls: prepared.manifest.expected.modelCalls, estimatedCostUsd: prepared.manifest.expected.estimatedCostUsd, approvalCommand: `bun run benchmark:approve -- --manifest ${prepared.path} --fingerprint ${prepared.fingerprint}` }, null, 2)); return; }
  if (parsed.command === "approve") { const path = resolve(value(parsed.options, "manifest")); const manifest = readManifest(path); assertApprovalAllowed(manifest); const fingerprint = value(parsed.options, "fingerprint"); if (fingerprintManifest(manifest) !== fingerprint) throw new Error("approval fingerprint mismatch"); const approvalPath = join(dirname(path), `${basename(path, ".json")}.approval.json`); writeApproval(approvalPath, fingerprint, new Date().toISOString()); console.log(approvalPath); return; }
  if (parsed.command === "run") {
    const path = resolve(value(parsed.options, "manifest")); const manifest = readManifest(path); const approvalPath = join(dirname(path), `${basename(path, ".json")}.approval.json`); if (!existsSync(approvalPath)) throw new Error("benchmark run requires explicit approval"); const approval = readApproval(approvalPath); validateApproval(approval, fingerprintManifest(manifest)); requireRunnableManifest(manifest, approval.manifestFingerprint);
    if (manifest.preset !== "contract") throw new Error("official benchmark execution is disabled until its prepared manifest and cost assumptions receive a separate run authorization");
    console.log(await runContractBenchmark({ repoRoot, manifestPath: path, approvalPath })); return;
  }
  if (parsed.command === "resume") { const runDir = resolve(value(parsed.options, "run")); const verification = await verifyBenchmarkRun(runDir); if (verification.verified) { console.log(runDir); return; } throw new Error("resume requires an interrupted case journal; automatic official reruns remain disabled"); }
  if (parsed.command === "verify") { const runDir = resolve(value(parsed.options, "run")); const verification = await verifyBenchmarkRun(runDir); writeJsonAtomic(join(runDir, "verification.json"), verification); console.log(JSON.stringify(verification, null, 2)); if (!verification.verified) process.exitCode = 1; return; }
  if (parsed.command === "report") { const runDir = resolve(value(parsed.options, "run")); const verification = await verifyBenchmarkRun(runDir); const report = renderPublicReport(runDir, verification); writeJsonAtomic(join(runDir, "public-report.json"), report); const markdown = renderPublicMarkdown(report); await Bun.write(join(runDir, "public-report.md"), markdown); console.log(join(runDir, "public-report.md")); return; }
  throw new Error(`unsupported benchmark command: ${parsed.command}`);
}
if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
