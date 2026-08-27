import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const fixtureRoot = join(import.meta.dir, "../fixtures/pi-governance-conformance");
const contractPath = join(fixtureRoot, "contract.json");
const expectedContractDigest = "edcdf007066715de33ff786a8757d16f84e08e6630d599390ed7450b076cafb7";

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("shared pi-governance conformance contract", () => {
  test("pins the shared contract and every semantic fixture", () => {
    expect(sha256(contractPath)).toBe(expectedContractDigest);
    const contract = JSON.parse(readFileSync(contractPath, "utf-8")) as {
      files: Record<string, string>;
    };
    for (const [name, digest] of Object.entries(contract.files)) {
      expect(sha256(join(fixtureRoot, name))).toBe(digest);
    }
  });
});
