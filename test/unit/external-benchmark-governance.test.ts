import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifest } from "./external-benchmark-manifest.test";
import { readManifest, validateApproval, validateManifest, writeApproval, writeManifest } from "../../eval/external/core/manifest";
import { assertBenchmarkRootIsolated, createRunPaths, resolveOutputRoot } from "../../eval/external/core/paths";

const approval = { schemaVersion: 1 as const, manifestFingerprint: "a".repeat(64), approvedAt: "2026-08-01T10:00:00.000Z", mode: "explicit" as const };

describe("external benchmark governance", () => {
  test("requires a complete exact approval fingerprint", () => {
    expect(() => validateApproval(approval, "a".repeat(63) + "b")).toThrow("approval fingerprint mismatch");
    expect(() => validateApproval(approval, "a".repeat(63))).toThrow("64-character");
    expect(() => validateApproval(approval, "a".repeat(64))).not.toThrow();
  });
  test("rejects malformed manifests", () => {
    expect(() => validateManifest({ ...manifest, cases: ["x", "x"] })).toThrow("duplicate case");
    expect(() => validateManifest({ ...manifest, models: [{ ...manifest.models[0], id: "" }] })).toThrow("model identifier");
    expect(() => validateManifest({ ...manifest, outputRoot: "/tmp/runs" })).toThrow("repository-relative");
    expect(() => validateManifest({ ...manifest, dataset: { ...manifest.dataset, files: [{ path: "x", sha256: "bad" }] } })).toThrow("SHA-256");
    expect(() => validateManifest({ ...manifest, pi: { ...manifest.pi, commit: "short" } })).toThrow("PI commit");
    expect(() => validateManifest({ ...manifest, promptHashes: { reader: "bad" } })).toThrow("prompt hash");
    expect(() => validateManifest({ ...manifest, dataset: { ...manifest.dataset, files: [{ path: "../gold", sha256: "a".repeat(64) }] } })).toThrow("relative");
    expect(() => validateManifest({ ...manifest, retry: { maxAttempts: 0, baseDelayMs: -1 } })).toThrow("retry");
    expect(() => validateManifest({ ...manifest, unexpected: true })).toThrow("unknown manifest field");
  });
  test("writes canonical manifests and approvals atomically", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-benchmark-governance-")); const path = join(dir, "manifest.json");
    const fingerprint = writeManifest(path, manifest);
    expect(readManifest(path)).toEqual(manifest);
    expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
    const written = writeApproval(join(dir, "approval.json"), fingerprint, "2026-08-01T10:00:00.000Z");
    expect(written.manifestFingerprint).toBe(fingerprint);
  });
  test("rejects roots overlapping the live store in either direction", () => {
    expect(() => assertBenchmarkRootIsolated("/home/test/.pi/agent/pi-memory/case", "/home/test/.pi/agent/pi-memory")).toThrow("overlaps live PI store");
    expect(() => assertBenchmarkRootIsolated("/home/test/.pi/agent", "/home/test/.pi/agent/pi-memory")).toThrow("overlaps live PI store");
    expect(() => assertBenchmarkRootIsolated("/tmp/run", "/home/test/.pi/agent/pi-memory")).not.toThrow();
  });
  test("resolves repository-relative output and unique case roots", () => {
    const repo = mkdtempSync(join(tmpdir(), "pi-benchmark-repo-"));
    expect(resolveOutputRoot(repo, "reports/benchmarks/runs")).toBe(join(repo, "reports/benchmarks/runs"));
    const paths = createRunPaths(repo, "reports/benchmarks/runs", "f".repeat(64));
    const first = paths.caseRoot("c/1", "production"); const second = paths.caseRoot("c/1", "diagnostic");
    expect(first).not.toBe(second); expect(existsSync(paths.runDir)).toBe(true);
    expect(paths.caseRoot("a/b", "production")).not.toBe(paths.caseRoot("a-b", "production"));
  });
});
