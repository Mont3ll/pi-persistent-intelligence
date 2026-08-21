import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findPublicArtifactLeaks, redactPublicArtifact } from "./artifacts";
import { fingerprintManifest, sha256File } from "./fingerprint";
import { readApproval, readManifest, validateApproval } from "./manifest";
import { readStateJournal } from "./run-state";
import type { BenchmarkVerification } from "./types";

interface RunResult { caseId: string; track: "production" | "diagnostic"; diagnostic: boolean; latencyMs?: number; contextChars?: number }
type TrackMetrics = Partial<Record<"production" | "diagnostic", Record<string, number>>>;
interface RunSummary { manifestFingerprint?: string; status?: string; models?: string[]; officialMetrics?: TrackMetrics; results?: RunResult[]; [key: string]: unknown }
function finding(findings: BenchmarkVerification["findings"], code: string, message: string, severity: "error" | "warning" = "error"): void { findings.push({ severity, code, message }); }
export async function verifyBenchmarkRun(runDir: string): Promise<BenchmarkVerification> {
  const findings: BenchmarkVerification["findings"] = []; const hashes: Record<string, string> = {}; const required = ["manifest.json", "approval.json", "state.jsonl", "run.json"];
  for (const name of required) if (!existsSync(join(runDir, name))) finding(findings, "missing_artifact", `Missing required artifact: ${name}`);
  if (findings.length) return { schemaVersion: 1, runFingerprint: "", verified: false, publishable: false, completedCases: 0, expectedCases: 0, findings, artifactHashes: hashes };
  const manifest = readManifest(join(runDir, "manifest.json")); const current = fingerprintManifest(manifest); let summary: RunSummary = {};
  try { validateApproval(readApproval(join(runDir, "approval.json")), current); } catch (error) { finding(findings, "approval_invalid", error instanceof Error ? error.message : String(error)); }
  try { summary = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as RunSummary; } catch { finding(findings, "run_malformed", "Run summary is not valid JSON"); }
  if (summary.manifestFingerprint !== current) finding(findings, "fingerprint_drift", "Run fingerprint differs from the frozen manifest");
  const expectedModelIds = manifest.models.map((model) => model.id).sort(); const actualModelIds = [...(summary.models ?? [])].sort(); if (JSON.stringify(expectedModelIds) !== JSON.stringify(actualModelIds)) finding(findings, "model_identity_mismatch", "Run model identities differ from the manifest");
  if (!summary.officialMetrics) finding(findings, "missing_official_metrics", "Run has no official metrics grouped by track");
  else for (const track of manifest.tracks) { const metrics = summary.officialMetrics[track]; if (!metrics || !Object.keys(metrics).length || Object.values(metrics).some((metric) => typeof metric !== "number" || !Number.isFinite(metric))) finding(findings, "missing_official_metrics", `Run has no valid ${track} official metrics`); }
  const results = Array.isArray(summary.results) ? summary.results : []; const resultKeys = new Set<string>(); const expectedKeys = manifest.cases.flatMap((caseId) => manifest.tracks.map((track) => `${caseId}:${track}`)); const expectedSet = new Set(expectedKeys);
  for (const result of results) { const key = `${result.caseId}:${result.track}`; if (!expectedSet.has(key)) finding(findings, "unexpected_case", `Unexpected result ${key}`); if (resultKeys.has(key)) finding(findings, "duplicate_case", `Duplicate result ${key}`); resultKeys.add(key); if ((result.track === "production" && result.diagnostic) || (result.track === "diagnostic" && !result.diagnostic)) finding(findings, "track_mislabeled", `Result ${key} mixes production and diagnostic semantics`); }
  let states: ReturnType<typeof readStateJournal> = []; try { states = readStateJournal(join(runDir, "state.jsonl")); } catch (error) { finding(findings, "invalid_state_journal", error instanceof Error ? error.message : String(error)); }
  const stateKeys = new Set(states.map((event) => `${event.caseId}:${event.track}`)); for (const key of stateKeys) if (!expectedSet.has(key)) finding(findings, "unexpected_case", `Unexpected state journal key ${key}`);
  const verifiedKeys = new Set(states.filter((event) => event.stage === "verified").map((event) => `${event.caseId}:${event.track}`));
  for (const key of expectedKeys) { if (!verifiedKeys.has(key)) finding(findings, "incomplete_case", `Case track did not reach verified through a legal journal: ${key}`); if (!resultKeys.has(key)) finding(findings, "missing_case_result", `Run summary lacks result: ${key}`); }
  const redactedCandidate = redactPublicArtifact({ manifest, summary }); for (const leak of findPublicArtifactLeaks(redactedCandidate)) finding(findings, "public_artifact_leak", `Redacted public artifact still contains ${leak}`);
  for (const name of required) hashes[name] = await sha256File(join(runDir, name));
  const verified = !findings.some((item) => item.severity === "error"); const publishable = verified && manifest.pi.clean && manifest.preset !== "contract";
  return { schemaVersion: 1, runFingerprint: current, verified, publishable, completedCases: verifiedKeys.size, expectedCases: expectedKeys.length, findings, artifactHashes: hashes };
}
export function assertPublicExportable(verification: BenchmarkVerification): void { if (!verification.verified || !verification.publishable) throw new Error("benchmark run is not publishable"); }
export function renderPublicReport(runDir: string, verification: BenchmarkVerification) {
  const manifest = readManifest(join(runDir, "manifest.json")); const summary = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) as RunSummary;
  return redactPublicArtifact({ schemaVersion: 1, manifestFingerprint: verification.runFingerprint, benchmark: manifest.benchmark, preset: manifest.preset, tracks: manifest.tracks, piCommit: manifest.pi.commit, upstream: manifest.upstream, dataset: manifest.dataset, models: manifest.models, curationPolicy: manifest.curationPolicy, context: manifest.context, seeds: manifest.seeds, retry: manifest.retry, status: summary.status, officialMetrics: summary.officialMetrics, diagnostics: summary.results, verification, limitations: ["Diagnostic-substrate results are not production scores.", "Contract runs use fake local readers and judges.", "No cross-benchmark composite is calculated."], runMetadata: summary });
}
export function renderPublicMarkdown(report: ReturnType<typeof renderPublicReport>): string {
  const metrics = report.officialMetrics ?? {};
  const metricSections = report.tracks.flatMap((track) => ["", `### ${track === "production" ? "Governed-production" : "Diagnostic-substrate"}`, ...Object.entries(metrics[track] ?? {}).map(([name, value]) => `- ${name}: ${value}`)]);
  return [`# ${report.benchmark} benchmark report`, "", `- Preset: ${report.preset}`, `- Manifest: \`${report.manifestFingerprint}\``, `- PI commit: \`${report.piCommit}\``, `- Tracks: ${report.tracks.join(", ")}`, `- Publishable: ${report.verification.publishable ? "yes" : "no"}`, "", "## Official metrics by track", ...metricSections, "", "## Limitations", ...report.limitations.map((item) => `- ${item}`), ""].join("\n");
}
