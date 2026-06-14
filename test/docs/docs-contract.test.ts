import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { loadConfig } from "../../src/config";

const readme = readFileSync("README.md", "utf-8");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { name: string; version: string; files?: string[]; scripts?: Record<string, string> };

function commandNamesFromIndex(): string[] {
  const src = readFileSync("index.ts", "utf-8");
  return [...src.matchAll(/registerCommand\("([^"]+)"/g)].map((m) => m[1]);
}

describe("docs contract", () => {
  test("README slash commands reference real registered commands", () => {
    const registered = new Set(commandNamesFromIndex());
    const documented = [...readme.matchAll(/`\/(memory-[a-z0-9-]+|curate-memory|maintain-memory|meta-consolidation|render-memory|consolidate-memory|setup-session-search|session-sync|session-reindex|procedure-candidates)(?:\s[^`]*)?`/g)].map((m) => m[1]);
    expect(documented.length).toBeGreaterThan(0);
    const missing = [...new Set(documented)].filter((cmd) => !registered.has(cmd));
    expect(missing).toEqual([]);
  });

  test("README config examples use canonical config keys", () => {
    const defaults = loadConfig("/tmp/pi-docs-contract-nonexistent-root");
    expect(defaults.curator).toBeDefined();
    expect(defaults.metaConsolidation).toBeDefined();
    expect(readme).toContain("autoCurate");
    expect(readme).toContain("metaConsolidation");
    expect(readme).not.toContain("auto_curate");
    expect(readme).not.toContain("meta_consolidation");
  });

  test("package identity and public install command are consistent", () => {
    expect(readme).toContain(pkg.name);
    expect(readme).toContain(`pi install npm:${pkg.name}`);
    const changelog = readFileSync("CHANGELOG.md", "utf-8");
    expect(changelog).toContain(pkg.version);
  });

  test("package files exclude local reports, fixtures, tests, and private memory", () => {
    expect(pkg.files ?? []).toEqual(expect.arrayContaining(["index.ts", "src", "skills", "docs/wiki", "docs/retain-recall-reflect.md", "README.md", "CHANGELOG.md", "LICENSE"]));
    for (const forbidden of ["docs", "reports", "test", "eval", ".pi", "memory", "fixtures"]) {
      expect(pkg.files ?? []).not.toContain(forbidden);
    }
    for (const fileEntry of pkg.files ?? []) {
      expect(fileEntry).not.toMatch(/SPRINT|INTEGRATION|RELEASE-PREP|dogfood/i);
    }
  });

  test("docs root contains only public documentation entry points", () => {
    const rootDocs = readdirSync("docs", { withFileTypes: true }).map((entry) => entry.name).sort();
    expect(rootDocs).toEqual(["retain-recall-reflect.md", "wiki"]);
  });
});
