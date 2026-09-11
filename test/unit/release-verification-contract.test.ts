import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  packageManager?: string;
  scripts?: Record<string, string>;
};
const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
const publish = readFileSync(join(root, ".github/workflows/publish.yml"), "utf8");

describe("release verification contract", () => {
  test("pins the Bun runtime in package.json and removes floating workflow pins", () => {
    expect(pkg.packageManager).toBe("bun@1.3.13");
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
