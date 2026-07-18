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

  test("normalizes set-like arrays and volatile bundle envelope fields only", () => {
    const source = fixture<PiGovernanceBundle>("full-bundle.json");
    const destination = structuredClone(source);
    destination.exported_at = "2030-01-01T00:00:00Z";
    destination.producer.version = "99.0.0";
    destination.records[0].tags.reverse();
    destination.records[0].evidence?.reverse();

    const normalized = reconcilePiGovernanceBundles(source, destination);
    expect(normalized.sections.records.divergent_ids).toEqual([]);
    expect(normalized.sections.records.matching_ids).toContain("rec_match");

    destination.records[0].status = "contested";
    const substantive = reconcilePiGovernanceBundles(source, destination);
    expect(substantive.sections.records.divergent_ids).toContain("rec_match");
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
