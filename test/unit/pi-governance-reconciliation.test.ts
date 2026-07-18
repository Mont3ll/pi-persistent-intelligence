import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reconcilePiGovernanceBundles } from "../../src/pi-governance-reconciliation";
import type { PiGovernanceBundle } from "../../src/pi-governance-compat";

const fixtures = join(import.meta.dir, "../fixtures/pi-governance-conformance");

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixtures, name), "utf-8")) as T;
}

describe("pi-governance reconciliation fixtures", () => {
  test("reconciliation_fixture report matches the shared semantic contract", () => {
    const report = reconcilePiGovernanceBundles(
      fixture<PiGovernanceBundle>("full-bundle.json"),
      fixture<PiGovernanceBundle>("filtered-bundle.json"),
    );

    expect(report).toEqual(fixture("reconciliation-expected.json"));
  });

  test("reconciliation_fixture classifies exact and conflicting duplicate IDs", () => {
    const duplicate = fixture<PiGovernanceBundle>("duplicate-input.json");
    const empty: PiGovernanceBundle = { ...duplicate, records: [] };

    const report = reconcilePiGovernanceBundles(duplicate, empty);

    expect(report.sections.records.source_duplicate_ids).toEqual([
      "rec_conflicting_duplicate",
      "rec_exact_duplicate",
    ]);
    expect(report.sections.records.conflicting_duplicate_ids).toEqual([
      "rec_conflicting_duplicate",
    ]);
  });
});
