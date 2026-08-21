import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifest } from "./external-benchmark-manifest.test";
import { expandTracks, parseCli, prepareBenchmark, requireRunnableManifest, runContractBenchmark } from "../../eval/external/cli";
import { writeApproval } from "../../eval/external/core/manifest";
import { verifyBenchmarkRun } from "../../eval/external/core/report";
import { getBenchmarkAdapter } from "../../eval/external/benchmarks/registry";

const repoRoot = process.cwd();
describe("external benchmark CLI", () => {
  test("parses exact commands and track expansion", () => {
    expect(parseCli(["prepare", "--benchmark", "ama-bench", "--preset", "contract", "--track", "both"]).command).toBe("prepare");
    expect(expandTracks("both")).toEqual(["production", "diagnostic"]);
    expect(() => expandTracks("all")).toThrow("track");
    expect(() => parseCli(["unknown"])).toThrow("unknown benchmark command");
  });
  test("registry refuses unknown benchmark names", () => { expect(() => getBenchmarkAdapter("other")).toThrow("unknown external benchmark"); });
  test("requires exact approval and clean tree for public runs", () => {
    expect(() => requireRunnableManifest({ ...manifest, pi: { ...manifest.pi, clean: false } }, undefined)).toThrow("clean worktree");
    expect(() => requireRunnableManifest({ ...manifest, preset: "contract" }, undefined)).toThrow("approval");
    expect(() => requireRunnableManifest({ ...manifest, preset: "contract" }, "a".repeat(10))).toThrow("64-character");
  });
  test("prepares deterministic contract cases without network", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "pi-benchmark-cli-"));
    const first = await prepareBenchmark({ repoRoot, benchmark: "ama-bench", preset: "contract", tracks: ["production", "diagnostic"], outputRoot });
    const second = await prepareBenchmark({ repoRoot, benchmark: "ama-bench", preset: "contract", tracks: ["production", "diagnostic"], outputRoot });
    expect(first.fingerprint).toBe(second.fingerprint); expect(first.manifest.cases).toEqual(["synthetic-1"]); expect(first.manifest.expected.estimatedCostUsd).toBe(0);
  });
  test("runs and verifies an approved network-free contract", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-benchmark-contract-")); const prepared = await prepareBenchmark({ repoRoot, benchmark: "ama-bench", preset: "contract", tracks: ["production", "diagnostic"], outputRoot: join(root, "manifests") });
    const approvalPath = join(root, "approval.json"); writeApproval(approvalPath, prepared.fingerprint, "2026-08-01T00:00:00Z");
    const runDir = await runContractBenchmark({ repoRoot, manifestPath: prepared.path, approvalPath, runsRoot: join(root, "runs") });
    const verification = await verifyBenchmarkRun(runDir); expect(verification.verified).toBe(true); expect(verification.publishable).toBe(false); expect(verification.completedCases).toBe(2);
  });
});
