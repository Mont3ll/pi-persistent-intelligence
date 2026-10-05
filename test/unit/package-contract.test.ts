import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HOST_RUNTIME_PACKAGES = [
  "@earendil-works/pi-tui",
  "@sinclair/typebox",
] as const;

function readPackageJson(): {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf8"));
}

describe("package host-runtime contract", () => {
  test("declares host-provided runtime packages as wildcard peers only", () => {
    const pkg = readPackageJson();

    for (const name of HOST_RUNTIME_PACKAGES) {
      expect(pkg.peerDependencies?.[name]).toBe("*");
      expect(pkg.dependencies?.[name]).toBeUndefined();
    }
  });
});
