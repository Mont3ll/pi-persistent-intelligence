import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalJson } from "../../eval/external/core/canonical-json";
import { fingerprintManifest, sha256File } from "../../eval/external/core/fingerprint";
import type { BenchmarkManifest } from "../../eval/external/core/types";

export const manifest: BenchmarkManifest = {
  schemaVersion: 1, benchmark: "ama-bench", preset: "smoke", tracks: ["production", "diagnostic"],
  pi: { commit: "a".repeat(40), clean: true, sourceHash: "b".repeat(64) },
  upstream: { url: "https://github.com/AMA-Bench/AMA-Bench", commit: "c".repeat(40) },
  dataset: { url: "https://example.test/data", revision: "main", files: [{ path: "test.jsonl", sha256: "d".repeat(64) }] },
  cases: ["software-1"], models: [{ role: "reader", id: "official-reader", provider: "official" }],
  promptHashes: { reader: "e".repeat(64) }, context: { maxTokens: 14000, maxRecords: 12 },
  curationPolicy: "pi-default-high-only-v1", seeds: [0], retry: { maxAttempts: 2, baseDelayMs: 1000 },
  environment: { bun: "1", python: "3.11", platform: "linux-x64" },
  expected: { cases: 1, modelCalls: 2, estimatedCostUsd: 0 }, outputRoot: "reports/benchmarks/runs",
};

describe("external benchmark manifest", () => {
  test("sorts object keys while preserving array order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 1 }, b: [2, 1] })).toBe('{"a":{"x":1,"y":2},"b":[2,1],"z":1}');
    expect(() => canonicalJson({ n: Number.NaN })).toThrow("finite");
    expect(() => canonicalJson({ value: undefined })).toThrow("unsupported");
  });
  test("is stable for key order and sensitive to governed drift", () => {
    const first = fingerprintManifest(manifest);
    expect(first).toHaveLength(64);
    expect(fingerprintManifest(JSON.parse(JSON.stringify(manifest)))).toBe(first);
    expect(fingerprintManifest({ ...manifest, cases: ["software-2"] })).not.toBe(first);
    expect(fingerprintManifest({ ...manifest, tracks: [...manifest.tracks].reverse() })).not.toBe(first);
  });
  test("hashes files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-benchmark-hash-")); const path = join(dir, "input");
    writeFileSync(path, "abc");
    expect(await sha256File(path)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
