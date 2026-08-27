import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { readEvidenceRecords } from "../../src/evidence";
import { readInquiryRecords } from "../../src/inquiries";
import { importFromPiGovernanceBundle, type PiGovernanceBundle } from "../../src/pi-governance-compat";
import { ensureMemoryDirs } from "../../src/paths";
import { readPortableEvents } from "../../src/portable-events";
import { readReinforcementEvents } from "../../src/reinforcement";
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

  test("imports the full semantic fixture into valid typed stores", () => {
    const root = temporaryRoot();
    try {
      importFromPiGovernanceBundle(root, fixture<PiGovernanceBundle>("full-bundle.json"), { dryRun: false });

      expect(loadAllRecords(root).find((record) => record.id === "rec_source_only")?.scope)
        .toEqual({ type: "domain", domains: ["healthcare"] });
      expect(readEvidenceRecords(root)).toContainEqual(expect.objectContaining({
        id: "evidence_match",
        source_kind: "external_document",
        trust_class: "unknown",
        polarity: "qualifies",
        related_memory_ids: ["rec_match"],
      }));
      expect(readInquiryRecords(root)).toContainEqual(expect.objectContaining({
        id: "inquiry_match",
        status: "open",
        related_memory_ids: ["rec_match"],
      }));
      expect(readReinforcementEvents(root)).toContainEqual(expect.objectContaining({
        id: "reinforcement_match",
        outcome: "explicit_reinforcement",
        memory_id: "rec_match",
      }));
      expect(readPortableEvents(root).map((event) => event.id)).toEqual(["event_match", "event_source_only"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("describes every full-bundle section and redacted omission in the shared contract", () => {
    const contract = fixture<{
      expectations: {
        fullBundle: Record<string, string[]>;
        redactedBundle: { redacted: boolean; records: string[]; evidence: string[]; omittedSections: string[] };
      };
    }>("contract.json");
    const full = fixture<Record<string, unknown[]>>("full-bundle.json");
    for (const [section, ids] of Object.entries(contract.expectations.fullBundle)) {
      expect(full[section].map((item) => (item as { id: string }).id)).toEqual(ids);
    }

    const redacted = fixture<Record<string, unknown>>("redacted-bundle.json");
    expect(redacted.redacted).toBe(contract.expectations.redactedBundle.redacted);
    expect((redacted.records as Array<{ id: string }>).map((item) => item.id)).toEqual(contract.expectations.redactedBundle.records);
    expect((redacted.evidence as Array<{ id: string }>).map((item) => item.id)).toEqual(contract.expectations.redactedBundle.evidence);
    for (const section of contract.expectations.redactedBundle.omittedSections) {
      expect(redacted[section]).toEqual([]);
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
