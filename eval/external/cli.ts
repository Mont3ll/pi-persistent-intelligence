#!/usr/bin/env bun
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fingerprintManifest } from "./core/fingerprint";
import { readApproval, readManifest, validateApproval, writeApproval, writeManifest } from "./core/manifest";
import type { BenchmarkManifest, BenchmarkName, BenchmarkPreset, BenchmarkTrack } from "./core/types";
import { getBenchmarkAdapter } from "./benchmarks/registry";

const COMMANDS = new Set(["prepare", "approve", "run", "resume", "verify", "report"]);
export interface ParsedCli { command: string; options: Record<string, string | boolean> }
export interface PrepareBenchmarkInput { repoRoot: string; benchmark: BenchmarkName; preset: BenchmarkPreset; tracks: BenchmarkTrack[]; outputRoot?: string }
export function parseCli(argv: string[]): ParsedCli {
  const [command, ...rest] = argv; if (!command || command === "--help") return { command: "help", options: {} }; if (!COMMANDS.has(command)) throw new Error(`unknown benchmark command: ${command}`);
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index++) { const token = rest[index]; if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`); const key = token.slice(2); const next = rest[index + 1]; if (!next || next.startsWith("--")) options[key] = true; else { options[key] = next; index++; } }
  return { command, options };
}
export function expandTracks(value: string): BenchmarkTrack[] { if (value === "both") return ["production", "diagnostic"]; if (value === "production" || value === "diagnostic") return [value]; throw new Error(`invalid benchmark track: ${value}`); }
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
function value(options: Record<string, string | boolean>, key: string): string { const found = options[key]; if (typeof found !== "string" || !found) throw new Error(`--${key} is required`); return found; }
function help(): string { return ["External benchmark commands:", "  prepare --benchmark <name> --preset <contract|smoke|pilot|full> --track <production|diagnostic|both>", "  approve --manifest <path> --fingerprint <64-char sha256>", "  run --manifest <path>", "  resume --run <directory>", "  verify --run <directory>", "  report --run <directory>"].join("\n"); }
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseCli(argv); if (parsed.command === "help" || parsed.options.help) { console.log(help()); return; }
  const repoRoot = resolve(import.meta.dir, "../..");
  if (parsed.command === "prepare") { const benchmark = value(parsed.options, "benchmark") as BenchmarkName; const preset = value(parsed.options, "preset") as BenchmarkPreset; const tracks = expandTracks(value(parsed.options, "track")); const prepared = await prepareBenchmark({ repoRoot, benchmark, preset, tracks }); console.log(JSON.stringify({ manifest: prepared.path, fingerprint: prepared.fingerprint, expectedCalls: prepared.manifest.expected.modelCalls, estimatedCostUsd: prepared.manifest.expected.estimatedCostUsd, approvalCommand: `bun run benchmark:approve -- --manifest ${prepared.path} --fingerprint ${prepared.fingerprint}` }, null, 2)); return; }
  if (parsed.command === "approve") { const path = resolve(value(parsed.options, "manifest")); const manifest = readManifest(path); const fingerprint = value(parsed.options, "fingerprint"); if (fingerprintManifest(manifest) !== fingerprint) throw new Error("approval fingerprint mismatch"); const approvalPath = join(dirname(path), `${basename(path, ".json")}.approval.json`); writeApproval(approvalPath, fingerprint, new Date().toISOString()); console.log(approvalPath); return; }
  if (parsed.command === "run") { const path = resolve(value(parsed.options, "manifest")); const manifest = readManifest(path); const approvalPath = join(dirname(path), `${basename(path, ".json")}.approval.json`); if (!existsSync(approvalPath)) throw new Error("benchmark run requires explicit approval"); const approval = readApproval(approvalPath); validateApproval(approval, fingerprintManifest(manifest)); requireRunnableManifest(manifest, approval.manifestFingerprint); throw new Error("benchmark execution runner is not configured yet"); }
  throw new Error(`${parsed.command} requires a completed run artifact`);
}
if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
