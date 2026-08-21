import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("external benchmark documentation", () => {
  test("documents governance and semantic boundaries", () => {
    const docs = readFileSync("docs/wiki/external-benchmarks.md", "utf8");
    for (const phrase of ["governed-production", "diagnostic-substrate", "exact 64-character fingerprint", "live PI store", "model identities", "cost", "MemoryArena", "pi_adapter_unavailable"]) expect(docs).toContain(phrase);
    expect(docs).toContain("benchmark:prepare"); expect(docs).toContain("benchmark:verify");
  });
  test("keeps benchmark implementation and artifacts outside npm", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { files: string[]; scripts: Record<string, string> }; const files = pkg.files.join("\n");
    for (const excluded of ["eval", "reports", ".benchmark-cache"]) expect(files.split("\n")).not.toContain(excluded);
    expect(pkg.scripts.prepublishOnly).not.toContain("benchmark"); expect(pkg.scripts["release-audit"]).not.toContain("benchmark");
  });
  test("ignores local raw artifacts but allows validated public exports", () => {
    const ignore = readFileSync(".gitignore", "utf8"); expect(ignore).toContain(".benchmark-cache/"); expect(ignore).toContain("reports/benchmarks/manifests/"); expect(ignore).toContain("reports/benchmarks/runs/"); expect(ignore).not.toContain("reports/benchmarks/public/");
  });
});
