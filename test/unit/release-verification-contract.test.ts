import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  version?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
};
const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
const publish = readFileSync(join(root, ".github/workflows/publish.yml"), "utf8");

describe("release verification contract", () => {
  test("keeps the package version aligned with the governance export producer", () => {
    expect(pkg.version).toBe("0.17.5-rc.1");
    const producer = readFileSync(join(root, "src/pi-governance-compat.ts"), "utf8");
    expect(producer).toContain(`const PRODUCER_VERSION = "${pkg.version}";`);
  });

  test("documents manual release checks without claiming a hosted CI pass", () => {
    const manual = readFileSync(join(root, "docs/wiki/manual-release.md"), "utf8");
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    expect(manual).toContain("bun run release-audit");
    expect(manual).toContain("npm publish --tag next --access public");
    expect(manual).toContain("GitHub-hosted verification: unavailable (billing restriction)");
    expect(readme).toContain("docs/wiki/manual-release.md");
    expect(changelog).toContain("## [0.17.5-rc.1]");
    expect(readme).toContain("unpublished release candidate");
  });

  test("pins Bun 1.3.13 in package metadata and every workflow setup", () => {
    expect(pkg.packageManager).toBe("bun@1.3.13");
    expect(ci).toContain("bun-version: 1.3.13");
    expect(publish.match(/bun-version: 1\.3\.13/g)?.length).toBe(3);
    expect(ci).not.toContain("bun-version: latest");
    expect(publish).not.toContain("bun-version: latest");
  });

  test("defines one repository-owned PR verification command", () => {
    expect(pkg.scripts?.["verify:pr"]).toBe("bun run typecheck && bun test && bun run eval");
    expect(ci).toContain("run: bun run verify:pr");
  });

  test("defines release verification as PR verification plus release-only checks", () => {
    expect(pkg.scripts?.["release-audit"]).toBe(
      "bun run verify:pr && bun run test:stress && npm pack --dry-run",
    );
    expect(publish).toContain("run: bun run release-audit");
  });
});
