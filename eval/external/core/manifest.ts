import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalJson } from "./canonical-json";
import { fingerprintManifest } from "./fingerprint";
import type { BenchmarkApproval, BenchmarkManifest } from "./types";

const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const BENCHMARKS = new Set(["ama-bench", "longmemeval-v2", "memoryarena"]);
const PRESETS = new Set(["contract", "smoke", "pilot", "full"]);
const TRACKS = new Set(["production", "diagnostic"]);
const ROLES = new Set(["reader", "judge", "embedding", "controller"]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty`);
  return value;
}
function assertKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)); if (unknown.length) throw new Error(`unknown ${label} field: ${unknown.join(", ")}`);
}
function positiveInteger(value: unknown, label: string, allowZero = false): number {
  if (!Number.isInteger(value) || (value as number) < (allowZero ? 0 : 1)) throw new Error(`${label} must be ${allowZero ? "a nonnegative" : "a positive"} integer`); return value as number;
}
function relativePath(value: unknown, label: string): string {
  const path = nonEmpty(value, label); if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.split(/[\\/]+/).includes("..")) throw new Error(`${label} must be repository-relative`); return path;
}
function atomicText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, text, { mode: 0o600 });
  renameSync(temporary, path);
}

export function validateManifest(value: unknown): BenchmarkManifest {
  const item = object(value, "manifest");
  assertKeys(item, ["schemaVersion", "benchmark", "preset", "tracks", "pi", "upstream", "dataset", "cases", "models", "promptHashes", "context", "curationPolicy", "seeds", "retry", "environment", "expected", "outputRoot"], "manifest");
  if (item.schemaVersion !== 1) throw new Error("unsupported benchmark manifest schema version");
  if (!BENCHMARKS.has(String(item.benchmark))) throw new Error("unknown benchmark");
  if (!PRESETS.has(String(item.preset))) throw new Error("unknown benchmark preset");
  if (!Array.isArray(item.tracks) || item.tracks.length === 0 || item.tracks.some((track) => !TRACKS.has(String(track)))) throw new Error("invalid benchmark tracks");
  if (new Set(item.tracks).size !== item.tracks.length) throw new Error("duplicate track");
  const pi = object(item.pi, "pi"); assertKeys(pi, ["commit", "clean", "sourceHash"], "PI");
  if (!COMMIT.test(String(pi.commit))) throw new Error("PI commit must be a full 40-character commit"); if (typeof pi.clean !== "boolean") throw new Error("PI clean must be boolean"); if (!SHA256.test(String(pi.sourceHash))) throw new Error("PI source hash must be SHA-256");
  const upstream = object(item.upstream, "upstream"); assertKeys(upstream, ["url", "commit"], "upstream"); nonEmpty(upstream.url, "upstream URL"); if (!COMMIT.test(String(upstream.commit))) throw new Error("upstream commit must be a full 40-character commit");
  const dataset = object(item.dataset, "dataset"); assertKeys(dataset, ["url", "revision", "files"], "dataset"); nonEmpty(dataset.url, "dataset URL"); nonEmpty(dataset.revision, "dataset revision");
  if (!Array.isArray(dataset.files) || dataset.files.length === 0) throw new Error("dataset requires files"); const datasetPaths = new Set<string>();
  for (const raw of dataset.files) { const file = object(raw, "dataset file"); assertKeys(file, ["path", "sha256"], "dataset file"); const path = relativePath(file.path, "dataset file path"); if (datasetPaths.has(path)) throw new Error(`duplicate dataset file path: ${path}`); datasetPaths.add(path); if (!SHA256.test(String(file.sha256))) throw new Error("dataset file SHA-256 must be 64 lowercase hexadecimal characters"); }
  if (!Array.isArray(item.cases) || item.cases.length === 0 || item.cases.some((id) => typeof id !== "string" || !id)) throw new Error("manifest requires case identifiers"); if (new Set(item.cases).size !== item.cases.length) throw new Error("duplicate case identifier");
  if (!Array.isArray(item.models) || item.models.length === 0) throw new Error("manifest requires models"); const modelRoles = new Set<string>();
  for (const raw of item.models) { const model = object(raw, "model"); assertKeys(model, ["role", "id", "provider", "baseUrl"], "model"); if (!ROLES.has(String(model.role))) throw new Error("invalid model role"); if (modelRoles.has(String(model.role))) throw new Error(`duplicate model role: ${model.role}`); modelRoles.add(String(model.role)); nonEmpty(model.id, "model identifier"); nonEmpty(model.provider, "model provider"); if (model.baseUrl !== undefined) nonEmpty(model.baseUrl, "model base URL"); }
  const promptHashes = object(item.promptHashes, "prompt hashes"); for (const role of modelRoles) if (!SHA256.test(String(promptHashes[role]))) throw new Error(`prompt hash for ${role} must be SHA-256`); for (const [role, hash] of Object.entries(promptHashes)) if (!modelRoles.has(role) || !SHA256.test(String(hash))) throw new Error(`invalid prompt hash for ${role}`);
  const context = object(item.context, "context"); assertKeys(context, ["maxTokens", "maxRecords"], "context"); positiveInteger(context.maxTokens, "context maxTokens"); positiveInteger(context.maxRecords, "context maxRecords");
  if (item.curationPolicy !== "pi-default-high-only-v1") throw new Error("unsupported curation policy");
  if (!Array.isArray(item.seeds) || item.seeds.length === 0 || item.seeds.some((seed) => !Number.isInteger(seed))) throw new Error("seeds must be non-empty integers"); if (new Set(item.seeds).size !== item.seeds.length) throw new Error("duplicate seed");
  const retry = object(item.retry, "retry"); assertKeys(retry, ["maxAttempts", "baseDelayMs"], "retry"); positiveInteger(retry.maxAttempts, "retry maxAttempts"); positiveInteger(retry.baseDelayMs, "retry baseDelayMs", true);
  const environment = object(item.environment, "environment"); assertKeys(environment, ["bun", "python", "platform"], "environment"); nonEmpty(environment.bun, "Bun version"); nonEmpty(environment.python, "Python version"); nonEmpty(environment.platform, "platform");
  const expected = object(item.expected, "expected"); assertKeys(expected, ["cases", "modelCalls", "estimatedCostUsd"], "expected"); if (expected.cases !== item.cases.length) throw new Error("expected case count does not match selected cases"); positiveInteger(expected.modelCalls, "expected model calls", true); if (expected.estimatedCostUsd !== null && (typeof expected.estimatedCostUsd !== "number" || !Number.isFinite(expected.estimatedCostUsd) || expected.estimatedCostUsd < 0)) throw new Error("estimated cost must be null or a nonnegative finite number");
  relativePath(item.outputRoot, "output root");
  return item as unknown as BenchmarkManifest;
}

export function writeManifest(path: string, manifest: BenchmarkManifest): string {
  const valid = validateManifest(manifest); const fingerprint = fingerprintManifest(valid);
  atomicText(path, `${canonicalJson(valid)}\n`); return fingerprint;
}
export function readManifest(path: string): BenchmarkManifest { return validateManifest(JSON.parse(readFileSync(path, "utf8"))); }
export function writeApproval(path: string, fingerprint: string, now: string): BenchmarkApproval {
  if (!SHA256.test(fingerprint)) throw new Error("approval requires a full 64-character fingerprint");
  const approval: BenchmarkApproval = { schemaVersion: 1, manifestFingerprint: fingerprint, approvedAt: now, mode: "explicit" };
  atomicText(path, `${canonicalJson(approval)}\n`); return approval;
}
export function readApproval(path: string): BenchmarkApproval {
  const value = object(JSON.parse(readFileSync(path, "utf8")), "approval");
  if (value.schemaVersion !== 1 || value.mode !== "explicit" || typeof value.approvedAt !== "string" || typeof value.manifestFingerprint !== "string") throw new Error("invalid benchmark approval");
  return value as unknown as BenchmarkApproval;
}
export function validateApproval(approval: BenchmarkApproval, currentFingerprint: string): void {
  if (!SHA256.test(currentFingerprint) || !SHA256.test(approval.manifestFingerprint)) throw new Error("approval requires a full 64-character fingerprint");
  if (approval.manifestFingerprint !== currentFingerprint) throw new Error("approval fingerprint mismatch");
}
