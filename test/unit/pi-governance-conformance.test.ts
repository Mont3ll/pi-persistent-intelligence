import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { readEvidenceRecords } from "../../src/evidence";
import { readInquiryRecords } from "../../src/inquiries";
import { exportToPiGovernanceBundle, importFromPiGovernanceBundle, type PiGovernanceBundle } from "../../src/pi-governance-compat";
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
      expect(exportToPiGovernanceBundle(root).events?.map((event) => event.id)).toEqual(["event_match", "event_source_only"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("normalizes typed-looking invalid peer artifacts without inventing timestamps or provenance", () => {
    const root = temporaryRoot();
    try {
      const bundle = fixture<PiGovernanceBundle>("full-bundle.json");
      bundle.evidence = [{
        id: "evidence_invalid",
        resource_id: "peer-resource",
        profile_id: "peer-profile",
        source_kind: "invalid",
        source_ref: "peer:untrusted",
        source_summary: "Peer evidence",
        trust_class: "invalid",
        polarity: "invalid",
        related_memory_ids: ["rec_match"],
      }];
      bundle.inquiries = [{
        id: "inquiry_invalid",
        context: "peer",
        tags: [],
        sessions_touched: [],
        first_seen: "not-a-time",
        last_seen: "not-a-time",
        status: "invalid",
        priority: "urgent",
        record_ids: ["rec_match"],
      } as never];

      importFromPiGovernanceBundle(root, bundle, { dryRun: false });

      expect(readEvidenceRecords(root)).toContainEqual(expect.objectContaining({
        id: "evidence_invalid",
        created_at: "2026-07-18T00:00:00.000Z",
        source_kind: "external_document",
        source_ref: "pi-governance:evidence_invalid",
        trust_class: "unknown",
        polarity: "qualifies",
      }));
      expect(readInquiryRecords(root)).toContainEqual(expect.objectContaining({
        id: "inquiry_invalid",
        question: "Imported peer inquiry inquiry_invalid.",
        first_seen: "2026-07-18T00:00:00.000Z",
        status: "open",
        priority: "low",
      }));

      const noTimestamp = structuredClone(bundle);
      delete noTimestamp.exported_at;
      delete (noTimestamp.evidence[0] as Record<string, unknown>).created_at;
      noTimestamp.evidence[0] = { ...(noTimestamp.evidence[0] as Record<string, unknown>), id: "evidence_without_time" };
      const secondRoot = temporaryRoot();
      try {
        const result = importFromPiGovernanceBundle(secondRoot, noTimestamp, { dryRun: false });
        expect(result.warnings).toContain("Skipped peer evidence evidence_without_time because it has no valid timestamp.");
        expect(readEvidenceRecords(secondRoot)).toEqual([]);
      } finally {
        rmSync(secondRoot, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("enforces project-filter expectations after importing the full fixture", () => {
    const root = temporaryRoot();
    try {
      importFromPiGovernanceBundle(root, fixture<PiGovernanceBundle>("full-bundle.json"), { dryRun: false });
      const exported = exportToPiGovernanceBundle(root, { namespace: "persistent-intelligence", project: "alpha" });
      const expected = fixture<{
        expectations: { projectAlphaFromFull: Record<string, string[]> };
      }>("contract.json").expectations.projectAlphaFromFull;
      for (const [section, ids] of Object.entries(expected)) {
        expect((exported[section as keyof PiGovernanceBundle] as Array<{ id: string }>).map((item) => item.id).sort())
          .toEqual([...ids].sort());
      }
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
    expect((redacted.redaction as { enabled: boolean }).enabled).toBe(true);
    expect((redacted.records as Array<{ id: string }>).map((item) => item.id)).toEqual(contract.expectations.redactedBundle.records);
    expect((redacted.evidence as Array<{ id: string }>).map((item) => item.id)).toEqual(contract.expectations.redactedBundle.evidence);
    for (const section of contract.expectations.redactedBundle.omittedSections) {
      expect(redacted[section]).toEqual([]);
    }
  });

  test("rejects inconsistent redaction declarations and warns for an explicitly redacted import", () => {
    const root = temporaryRoot();
    try {
      const redacted = fixture<PiGovernanceBundle>("redacted-bundle.json");
      const preview = importFromPiGovernanceBundle(root, redacted, { dryRun: true });
      expect(preview.warnings).toContain("Bundle is redacted; import remains review-only unless redactedAware is set.");

      expect(() => importFromPiGovernanceBundle(root, {
        ...redacted,
        redaction: { ...redacted.redaction, enabled: false },
      }, { dryRun: true })).toThrow("Inconsistent bundle redaction metadata");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("collapses semantically equivalent duplicate records regardless of key order", () => {
    const root = temporaryRoot();
    try {
      const source = fixture<PiGovernanceBundle>("duplicate-input.json");
      const record = source.records[0];
      const reordered = Object.fromEntries(Object.entries(record).reverse()) as unknown as typeof record;
      (reordered as unknown as Record<string, unknown>).ignored_peer_field = "ignored";
      const bundle = { ...source, records: [record, reordered] };

      const result = importFromPiGovernanceBundle(root, bundle, { dryRun: false });

      expect(result.applied.records_added).toBe(1);
      expect(loadAllRecords(root).map((item) => item.id)).toEqual(["rec_exact_duplicate"]);
      expect(result.warnings).toContain("Collapsed 2 equivalent incoming rows for record rec_exact_duplicate.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("treats divergent Rust-supported record fields as conflicts", () => {
    const root = temporaryRoot();
    try {
      const source = fixture<PiGovernanceBundle>("duplicate-input.json");
      const record = source.records[0];
      const changedClass = { ...record, class: "preference" };

      const result = importFromPiGovernanceBundle(root, { ...source, records: [record, changedClass] }, { dryRun: false });

      expect(result.applied.records_added).toBe(0);
      expect(loadAllRecords(root)).toEqual([]);
      expect(result.warnings).toContain("Quarantined 2 divergent incoming rows for record rec_exact_duplicate.");
    } finally {
      rmSync(root, { recursive: true, force: true });
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
