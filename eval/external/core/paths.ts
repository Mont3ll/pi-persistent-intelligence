import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { BenchmarkTrack } from "./types";

function canonicalExisting(path: string): string {
  let ancestor = resolve(path); const suffix: string[] = [];
  while (!existsSync(ancestor)) { const parent = dirname(ancestor); if (parent === ancestor) break; suffix.unshift(ancestor.slice(parent.length + 1)); ancestor = parent; }
  const base = existsSync(ancestor) ? realpathSync(ancestor) : ancestor;
  return resolve(base, ...suffix);
}
function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}
function safeSegment(value: string): string {
  const segment = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!segment || segment === "." || segment === "..") throw new Error("invalid case identifier for benchmark path");
  return segment;
}

export function assertBenchmarkRootIsolated(benchmarkRoot: string, liveRoot: string): void {
  const benchmark = canonicalExisting(benchmarkRoot); const live = canonicalExisting(liveRoot);
  if (contains(live, benchmark) || contains(benchmark, live)) throw new Error(`benchmark root overlaps live PI store: ${benchmark}`);
}
export function resolveOutputRoot(repoRoot: string, outputRoot: string): string {
  if (isAbsolute(outputRoot) || outputRoot.split(/[\\/]+/).includes("..")) throw new Error("benchmark output root must be repository-relative");
  const resolved = resolve(repoRoot, outputRoot); if (!contains(resolve(repoRoot), resolved)) throw new Error("benchmark output escapes repository");
  return resolved;
}
export function createRunPaths(repoRoot: string, outputRoot: string, fingerprint: string) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error("run fingerprint must contain 64 lowercase hexadecimal characters");
  const outputDir = resolveOutputRoot(repoRoot, outputRoot); const runDir = join(outputDir, fingerprint);
  mkdirSync(runDir, { recursive: true });
  return {
    outputDir, runDir,
    manifest: join(runDir, "manifest.json"), approval: join(runDir, "approval.json"),
    caseRoot(caseId: string, track: BenchmarkTrack): string { const path = join(runDir, "cases", safeSegment(caseId), track, "pi-root"); mkdirSync(path, { recursive: true }); return path; },
  };
}
