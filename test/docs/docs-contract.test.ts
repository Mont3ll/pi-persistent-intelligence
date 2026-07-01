import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { loadConfig } from "../../src/config";

const readme = readFileSync("README.md", "utf-8");
const commandsDoc = readFileSync("docs/commands.md", "utf-8");
const publicDocs = [
  readme,
  commandsDoc,
  readFileSync("docs/pi-memory-contract.md", "utf-8"),
  readFileSync("docs/pi-governance-rs-compatibility.md", "utf-8"),
  readFileSync("docs/standalone-vs-shared-mode.md", "utf-8"),
  readFileSync("docs/export-import-pi-governance.md", "utf-8"),
  readFileSync("CHANGELOG.md", "utf-8"),
].join("\n");
const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { name: string; version: string; files?: string[]; scripts?: Record<string, string> };

function commandNamesFromIndex(): string[] {
  const src = readFileSync("index.ts", "utf-8");
  return [...src.matchAll(/registerCommand\("([^"]+)"/g)].map((m) => m[1]);
}

describe("docs contract", () => {
  test("public slash commands reference real registered commands", () => {
    const registered = new Set(commandNamesFromIndex());
    const documented = [...publicDocs.matchAll(/`\/(memory-[a-z0-9-]+|curate-memory|maintain-memory|meta-consolidation|render-memory|consolidate-memory|setup-session-search|session-sync|session-reindex|procedure-candidates)(?:\s[^`]*)?`/g)].map((m) => m[1]);
    expect(documented.length).toBeGreaterThan(0);
    const missing = [...new Set(documented)].filter((cmd) => !registered.has(cmd));
    expect(missing).toEqual([]);
  });

  test("public docs link core v0.12 documentation", () => {
    expect(readme).toContain("docs/commands.md");
    expect(readme).toContain("docs/pi-memory-contract.md");
    expect(readme).toContain("docs/pi-governance-rs-compatibility.md");
    expect(readme).toContain("docs/standalone-vs-shared-mode.md");
    expect(readme).toContain("docs/export-import-pi-governance.md");
    const defaults = loadConfig("/tmp/pi-docs-contract-nonexistent-root");
    expect(defaults.curator).toBeDefined();
    expect(defaults.metaConsolidation).toBeDefined();
    expect(publicDocs).not.toContain("auto_curate");
    expect(publicDocs).not.toContain('"meta_consolidation"');
  });

  test("package identity and public install command are consistent", () => {
    expect(readme).toContain(pkg.name);
    expect(readme).toContain(`pi install npm:${pkg.name}`);
    const changelog = readFileSync("CHANGELOG.md", "utf-8");
    expect(changelog).toContain(pkg.version);
  });

  test("package files exclude local reports, fixtures, tests, and private memory", () => {
    expect(pkg.files ?? []).toEqual(expect.arrayContaining(["index.ts", "src", "skills", "docs/wiki", "docs/retain-recall-reflect.md", "docs/pi-memory-contract.md", "docs/pi-governance-rs-compatibility.md", "docs/standalone-vs-shared-mode.md", "docs/export-import-pi-governance.md", "docs/commands.md", "README.md", "CHANGELOG.md", "LICENSE"]));
    for (const forbidden of ["docs", "reports", "test", "eval", ".pi", "memory", "fixtures"]) {
      expect(pkg.files ?? []).not.toContain(forbidden);
    }
    for (const fileEntry of pkg.files ?? []) {
      expect(fileEntry).not.toMatch(/SPRINT|INTEGRATION|RELEASE-PREP|dogfood/i);
    }
  });

  test("docs root contains only public documentation entry points", () => {
    const rootDocs = readdirSync("docs", { withFileTypes: true }).map((entry) => entry.name).sort();
    expect(rootDocs).toEqual(["commands.md", "export-import-pi-governance.md", "pi-governance-rs-compatibility.md", "pi-memory-contract.md", "retain-recall-reflect.md", "standalone-vs-shared-mode.md", "wiki"]);
  });

  test("wiki index links governance policy docs", () => {
    const wikiIndex = readFileSync("docs/wiki/index.md", "utf-8");
    expect(wikiIndex).toContain("conflict-resolution-policy.md");
    expect(wikiIndex).toContain("governance-regressions.md");
  });

  test("public docs avoid captured trace benchmark claims", () => {
    const docs = [publicDocs, readFileSync("docs/wiki/index.md", "utf-8"), readFileSync("docs/wiki/commands-and-tools.md", "utf-8")].join("\n");
    const forbidden = new RegExp(["real-session benchmark", ["production", "trace"].join(" "), ["out", "performs"].join("")].join("|"), "i");
    expect(docs).not.toMatch(forbidden);
  });

  test("public docs preserve architecture boundaries", () => {
    expect(readme).toContain("does not require Rust");
    expect(readme).toMatch(/does (?:not|\*\*not\*\*) (?:host or run|run) an MCP server/);
    expect(readme).not.toMatch(/requires pi-governance-rs/i);
    expect(readme).not.toMatch(/Rust is required/i);
  });

  test("README avoids report-style release status language", () => {
    expect(readme).not.toMatch(/blocker|partial success|pending approval|if approved|release gate|final git status|worktree clean|agent report|publishing readiness|remaining blockers/i);
  });
});
