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
function atomicText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, text, { mode: 0o600 });
  renameSync(temporary, path);
}

export function validateManifest(value: unknown): BenchmarkManifest {
  const item = object(value, "manifest");
  if (item.schemaVersion !== 1) throw new Error("unsupported benchmark manifest schema version");
  if (!BENCHMARKS.has(String(item.benchmark))) throw new Error("unknown benchmark");
  if (!PRESETS.has(String(item.preset))) throw new Error("unknown benchmark preset");
  if (!Array.isArray(item.tracks) || item.tracks.length === 0 || item.tracks.some((track) => !TRACKS.has(String(track)))) throw new Error("invalid benchmark tracks");
  if (new Set(item.tracks).size !== item.tracks.length) throw new Error("duplicate track");
  const pi = object(item.pi, "pi"); nonEmpty(pi.commit, "PI commit"); nonEmpty(pi.sourceHash, "PI source hash");
  const upstream = object(item.upstream, "upstream"); nonEmpty(upstream.url, "upstream URL");
  if (!COMMIT.test(String(upstream.commit))) throw new Error("upstream commit must be a full 40-character commit");
  const dataset = object(item.dataset, "dataset"); nonEmpty(dataset.url, "dataset URL"); nonEmpty(dataset.revision, "dataset revision");
  if (!Array.isArray(dataset.files) || dataset.files.length === 0) throw new Error("dataset requires files");
  for (const raw of dataset.files) { const file = object(raw, "dataset file"); nonEmpty(file.path, "dataset file path"); if (!SHA256.test(String(file.sha256))) throw new Error("dataset file SHA-256 must be 64 lowercase hexadecimal characters"); }
  if (!Array.isArray(item.cases) || item.cases.length === 0 || item.cases.some((id) => typeof id !== "string" || !id)) throw new Error("manifest requires case identifiers");
  if (new Set(item.cases).size !== item.cases.length) throw new Error("duplicate case identifier");
  if (!Array.isArray(item.models) || item.models.length === 0) throw new Error("manifest requires models");
  for (const raw of item.models) { const model = object(raw, "model"); if (!ROLES.has(String(model.role))) throw new Error("invalid model role"); nonEmpty(model.id, "model identifier"); nonEmpty(model.provider, "model provider"); }
  const outputRoot = nonEmpty(item.outputRoot, "output root");
  if (outputRoot.startsWith("/") || /^[A-Za-z]:[\\/]/.test(outputRoot) || outputRoot.split(/[\\/]+/).includes("..")) throw new Error("output root must be repository-relative");
  const expected = object(item.expected, "expected");
  if (expected.cases !== item.cases.length) throw new Error("expected case count does not match selected cases");
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
