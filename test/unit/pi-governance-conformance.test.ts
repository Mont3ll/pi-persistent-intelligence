import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { importFromPiGovernanceBundle, type PiGovernanceBundle } from "../../src/pi-governance-compat";
import { ensureMemoryDirs } from "../../src/paths";
import { loadAllRecords } from "../../src/store";

const fixtureRoot = join(import.meta.dir, "../fixtures/pi-governance-conformance");
const contractPath = join(fixtureRoot, "contract.json");
const expectedContractDigest = "edcdf007066715de33ff786a8757d16f84e08e6630d599390ed7450b076cafb7";

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixtureRoot, name), "utf-8")) as T;
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-conformance-"));
  ensureMemoryDirs(root);
  return root;
}

describe("shared pi-governance conformance contract", () => {
  test("pins the shared contract and every semantic fixture", () => {
    expect(sha256(contractPath)).toBe(expectedContractDigest);
    const contract = fixture<{ files: Record<string, string> }>("contract.json");
    for (const [name, digest] of Object.entries(contract.files)) {
      expect(sha256(join(fixtureRoot, name))).toBe(digest);
    }
  });

  test("collapses equivalent duplicate records and quarantines divergent duplicate records", () => {
    const root = temporaryRoot();
    try {
      const result = importFromPiGovernanceBundle(
        root,
        fixture<PiGovernanceBundle>("duplicate-input.json"),
        { dryRun: false },
      );

      expect(result.applied.records_added).toBe(1);
      expect(loadAllRecords(root).map((record) => record.id)).toEqual(["rec_exact_duplicate"]);
      expect(result.warnings).toContain("Collapsed 2 equivalent incoming rows for record rec_exact_duplicate.");
      expect(result.warnings).toContain("Quarantined 2 divergent incoming rows for record rec_conflicting_duplicate.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
