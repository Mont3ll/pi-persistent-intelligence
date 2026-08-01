import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendCandidate, listCandidates } from "../../src/inbox";
import { appendDailyLog } from "../../src/daily";
import { appendEvidenceRecord, readEvidenceRecords } from "../../src/evidence";
import { appendInquiryRecord, createInquiryRecord, markInquiryStale, markInquiryWithdrawn, readInquiryRecords } from "../../src/inquiries";
import { appendDeletionTombstone, createDeletionTombstone } from "../../src/tombstones";
import { appendReinforcementEvent, createReinforcementEvent, readReinforcementEvents } from "../../src/reinforcement";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import { loadConfig } from "../../src/config";
import { readPortableEvents } from "../../src/portable-events";
import { processCaptureTurn } from "../../src/capture-coordinator";
import {
  exportToPiGovernanceBundle,
  importFromPiGovernanceBundle,
  runPiGovernanceDoctor,
  type PiGovernanceBundle,
} from "../../src/pi-governance-compat";
import type { CaptureCandidate, MemoryPatch, MemoryRecord } from "../../src/types";

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-governance-compat-"));
  ensureMemoryDirs(dir);
  return dir;
}

function cleanup(dir: string): void { rmSync(dir, { recursive: true, force: true }); }

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  const layer = overrides.layer ?? "L2";
  return {
    id: overrides.id ?? `mem_${layer}`,
    resource_id: "res_demo",
    profile_id: overrides.profile_id ?? "profile_demo",
    layer,
    scope: overrides.scope ?? { type: "project", project: "demo-project" },
    tags: overrides.tags ?? ["release"],
    statement: overrides.statement ?? "Always run release-audit before tagging.",
    evidence: overrides.evidence ?? [{ type: "manual", ref: "ev_demo", note: "User correction" }],
    confidence: overrides.confidence ?? 0.82,
    stability: overrides.stability ?? "semi-stable",
    created_at: overrides.created_at ?? "2026-06-30T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-06-30T00:00:00Z",
    review: overrides.review ?? { cadence_days: 30, next_review: "2026-07-30", change_condition: "Release flow changes." },
    status: overrides.status ?? "active",
    valid_from: overrides.valid_from,
    valid_to: overrides.valid_to,
    invalidated_by: overrides.invalidated_by,
    validity_reason: overrides.validity_reason,
    supersedes: overrides.supersedes ?? [],
    superseded_by: overrides.superseded_by ?? [],
    vault_ref: overrides.vault_ref ?? null,
    ruleType: overrides.ruleType ?? "workflow",
    memory_kind: overrides.memory_kind ?? "instruction",
  };
}

function candidate(overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id: overrides.id ?? "cap_demo",
    resource_id: "res_demo",
    profile_id: "profile_demo",
    created_at: "2026-06-30T00:00:00Z",
    source: { type: "manual", ref: "test" },
    text: overrides.text ?? "Prefer release-audit before tagging.",
    tags: ["release"],
    evidence_refs: ["ev_demo"],
    evidence_ids: ["ev_demo"],
    confidence: 0.81,
    status: overrides.status ?? "new",
    ruleType: "workflow",
    memory_kind: "instruction",
    primary_trust_class: "direct_user_instruction",
    durability_signal: "project",
    verification_status: "verified",
    ...overrides,
  };
}

describe("pi-governance-rs compatibility bundle", () => {
  test("exports layers, metadata, candidates, evidence, inquiries, reinforcement and tombstones", () => {
    const dir = root();
    try {
      unsafeAddMemoryRecord(dir, record({ id: "mem_l1", layer: "L1", scope: { type: "global" }, ruleType: "preference" }));
      unsafeAddMemoryRecord(dir, record({ id: "mem_l2", layer: "L2" }));
      unsafeAddMemoryRecord(dir, record({ id: "mem_deleted", status: "deleted", statement: "[deleted]", evidence: [{ type: "deletion", ref: "tomb_demo", note: "Content removed." }] }));
      appendDailyLog(dir, "2026-06-30", "#decision keep release namespace stable");
      appendCandidate(dir, candidate({ id: "cap_pending", status: "new" }));
      appendCandidate(dir, candidate({ id: "cap_rejected", status: "rejected" }));
      appendEvidenceRecord(dir, {
        id: "ev_demo", resource_id: "res_demo", profile_id: "profile_demo", created_at: "2026-06-30T00:00:00Z",
        source_kind: "conversation", source_summary: "User said release-audit is required.", trust_class: "direct_user_instruction",
        polarity: "supports", durability_signal: "project", related_memory_ids: ["mem_l2"], tags: ["release"],
      });
      appendInquiryRecord(dir, createInquiryRecord({ question: "Should this become L1?", context: "compat", now: "2026-06-30T00:00:00Z" }));
      appendReinforcementEvent(dir, createReinforcementEvent({ memory_id: "mem_l2", outcome: "explicit_reinforcement", now: "2026-06-30T00:00:00Z" }));
      appendDeletionTombstone(dir, createDeletionTombstone({ deleted_record_id: "mem_deleted", deletion_mode: "privacy_purge", deletion_reason: "privacy_sensitive", content: "secret text", now: "2026-06-30T00:00:00Z" }));

      const bundle = exportToPiGovernanceBundle(dir, { namespace: "interop-test" });

      expect(bundle.schema_version).toBe(1);
      expect(bundle.format).toBe("pi-governance");
      expect(bundle.producer).toEqual({ name: "pi-persistent-intelligence", version: "0.15.0" });
      expect(bundle.records.map((r) => [r.id, r.layer])).toContainEqual(["mem_l1", "l1_identity"]);
      expect(bundle.records.map((r) => [r.id, r.layer])).toContainEqual(["mem_l2", "l2_playbook"]);
      expect(bundle.records.find((r) => r.id === "mem_deleted")?.status).toBe("tombstoned");
      expect(bundle.sessions.map((s) => [s.layer, s.text])).toContainEqual(["l3_session", "#decision keep release namespace stable"]);
      expect(bundle.records.find((r) => r.id === "mem_l2")?.rule_type).toBe("workflow");
      expect(bundle.records.find((r) => r.id === "mem_l2")?.memory_kind).toBe("instruction");
      expect(bundle.records.find((r) => r.id === "mem_l2")?.trust_class).toBe("direct_user_instruction");
      expect(bundle.records.find((r) => r.id === "mem_l2")?.durability).toBe("project");
      expect(bundle.records.find((r) => r.id === "mem_l2")?.source_kind).toBe("manual_cli");
      expect(bundle.records.every((r) => !!r.created_at && !Number.isNaN(Date.parse(r.created_at)) && r.created_at.includes("T"))).toBe(true);
      expect(bundle.patches.find((p) => p.id === "cap_pending")?.status).toBe("proposed");
      expect(bundle.patches.find((p) => p.id === "cap_rejected")?.status).toBe("rejected");
      expect(bundle.evidence).toHaveLength(1);
      expect(bundle.inquiries).toHaveLength(1);
      expect(bundle.reinforcement).toHaveLength(1);
      expect(bundle.tombstones[0]).toMatchObject({ deleted_record_id: "mem_deleted", deletion_mode: "privacy_purge" });
    } finally { cleanup(dir); }
  });

  test("filters project/profile exports without relabeling records or unscoped sessions", () => {
    const dir = root();
    try {
      unsafeAddMemoryRecord(dir, record({ id: "mem_global", profile_id: "profile-a", scope: { type: "global" } }));
      unsafeAddMemoryRecord(dir, record({ id: "mem_alpha", profile_id: "profile-a", scope: { type: "project", project: "alpha" } }));
      unsafeAddMemoryRecord(dir, record({ id: "mem_beta", profile_id: "profile-a", scope: { type: "project", project: "beta" } }));
      unsafeAddMemoryRecord(dir, record({ id: "mem_domain", profile_id: "profile-a", scope: { type: "domain", domains: ["healthcare"] } }));
      unsafeAddMemoryRecord(dir, record({ id: "mem_other_profile", profile_id: "profile-b", scope: { type: "project", project: "alpha" } }));
      appendCandidate(dir, candidate({ id: "cap_alpha", profile_id: "profile-a", matched_memory_ids: ["mem_alpha"] }));
      appendCandidate(dir, candidate({ id: "cap_beta", profile_id: "profile-a", matched_memory_ids: ["mem_beta"] }));
      appendEvidenceRecord(dir, {
        id: "ev_alpha", resource_id: "res_demo", profile_id: "profile-a", created_at: "2026-06-30T00:00:00Z",
        source_kind: "conversation", source_summary: "alpha", trust_class: "direct_user_instruction", polarity: "supports",
        related_memory_ids: ["mem_alpha"], scope_level: "project", scope_ref: "alpha",
      });
      appendEvidenceRecord(dir, {
        id: "ev_beta", resource_id: "res_demo", profile_id: "profile-a", created_at: "2026-06-30T00:00:00Z",
        source_kind: "conversation", source_summary: "beta", trust_class: "direct_user_instruction", polarity: "supports",
        related_memory_ids: ["mem_beta"], scope_level: "project", scope_ref: "beta",
      });
      appendInquiryRecord(dir, createInquiryRecord({ question: "Alpha?", context: "alpha", profile_id: "profile-a", related_memory_ids: ["mem_alpha"], now: "2026-06-30T00:00:00Z" }));
      appendInquiryRecord(dir, createInquiryRecord({ question: "Beta?", context: "beta", profile_id: "profile-a", related_memory_ids: ["mem_beta"], now: "2026-06-30T00:00:00Z" }));
      appendReinforcementEvent(dir, createReinforcementEvent({ memory_id: "mem_alpha", profile_id: "profile-a", outcome: "explicit_reinforcement", now: "2026-06-30T00:00:00Z" }));
      appendReinforcementEvent(dir, createReinforcementEvent({ memory_id: "mem_beta", profile_id: "profile-a", outcome: "explicit_reinforcement", now: "2026-06-30T00:00:00Z" }));
      appendDeletionTombstone(dir, createDeletionTombstone({ deleted_record_id: "mem_alpha", profile_id: "profile-a", deletion_mode: "audit_preserving", deletion_reason: "user_requested", now: "2026-06-30T00:00:00Z" }));
      appendDeletionTombstone(dir, createDeletionTombstone({ deleted_record_id: "mem_beta", profile_id: "profile-a", deletion_mode: "audit_preserving", deletion_reason: "user_requested", now: "2026-06-30T00:00:00Z" }));
      appendDailyLog(dir, "2026-06-30", "unscoped daily session");

      const bundle = exportToPiGovernanceBundle(dir, { project: "alpha", profile_id: "profile-a" });

      expect(bundle.records.map((item) => item.id).sort()).toEqual(["mem_alpha", "mem_global"]);
      expect(bundle.records.find((item) => item.id === "mem_global")).toMatchObject({ scope: { level: "global", key: null }, project: undefined, profile_id: "profile-a" });
      expect(bundle.records.find((item) => item.id === "mem_alpha")).toMatchObject({ scope: { level: "project", key: "alpha" }, project: "alpha", profile_id: "profile-a" });
      expect(bundle.patches.map((item) => item.id)).toEqual(["cap_alpha"]);
      expect(bundle.evidence.map((item) => item.id)).toEqual(["ev_alpha"]);
      expect(bundle.inquiries).toHaveLength(1);
      expect(bundle.reinforcement).toHaveLength(1);
      expect(bundle.tombstones).toHaveLength(1);
      expect(bundle.sessions).toEqual([]);
      expect(bundle.warnings).toContain("Omitted 1 unscoped daily session entry because project/profile filters were requested.");
    } finally { cleanup(dir); }
  });

  test("rejects invalid portable timestamps instead of emitting malformed bundles", () => {
    const dir = root();
    try {
      unsafeAddMemoryRecord(dir, record({ id:"mem_bad_date", created_at:"not-a-date" }));
      expect(() => exportToPiGovernanceBundle(dir)).toThrow("Invalid portable timestamp");
    } finally { cleanup(dir); }
  });

  test("redacted export omits private source excerpts and marks redaction metadata", () => {
    const dir = root();
    try {
      appendEvidenceRecord(dir, {
        id: "ev_secret", resource_id: "res_demo", profile_id: "profile_demo", created_at: "2026-06-30T00:00:00Z",
        source_kind: "conversation", source_summary: "normal summary", source_excerpt: "private session details",
        trust_class: "single_session_observation", polarity: "supports", related_memory_ids: [],
      });
      const bundle = exportToPiGovernanceBundle(dir, { redacted: true });
      expect(bundle.redaction.enabled).toBe(true);
      expect(bundle.redaction.fields_checked).toContain("evidence.source_excerpt");
      expect(bundle.redaction.fields_redacted).toContain("evidence.source_excerpt");
      expect(bundle.evidence[0].source_excerpt).toBeUndefined();
    } finally { cleanup(dir); }
  });

  test("dry-run import reports planned changes and merge import skips duplicate ids", () => {
    const dir = root();
    try {
      unsafeAddMemoryRecord(dir, record({ id: "mem_existing", layer: "L2" }));
      const bundle: PiGovernanceBundle = {
        schema_version: 1,
        format: "pi-governance",
        producer: { name: "pi-governance-rs", version: "1.0.0" },
        records: [
          { id: "mem_existing", namespace: "default", profile_id: "profile_demo", project: "demo-project", layer: "l2_playbook", claim: "Duplicate", status: "active", memory_kind: "instruction", rule_type: "workflow", trust_class: "direct_user_instruction", durability: "project", source_kind: "manual", confidence: 0.8, evidence_ids: [], tags: [] },
          { id: "mem_new", namespace: "default", profile_id: "profile_demo", project: "demo-project", layer: "l1_identity", claim: "Prefer safe imports.", status: "active", memory_kind: "instruction", rule_type: "preference", trust_class: "direct_user_instruction", durability: "long_term", source_kind: "manual", confidence: 0.9, evidence_ids: [], tags: ["import"] },
          { id: "mem_deleted", namespace: "default", layer: "l2_playbook", claim: "Deleted", status: "tombstoned", memory_kind: "fact", source_kind: "manual", confidence: 0.5, evidence_ids: [], tags: [] },
        ],
        patches: [{ id: "patch_pending", status: "proposed", operation: "propose_record", claim: "Pending import candidate", layer: "l2_playbook", memory_kind: "instruction", rule_type: "workflow", tags: ["import"] }],
        evidence: [], inquiries: [], sessions: [], reinforcement: [], tombstones: [{ id: "tomb_import", deleted_record_id: "mem_deleted", deleted_at: "2026-06-30T00:00:00Z", deletion_mode: "audit_preserving", deletion_reason: "user_requested", content_removed: true }],
        redaction: { enabled: false, fields_checked: [], fields_redacted: [], notes: [] },
      };

      const dryRun = importFromPiGovernanceBundle(dir, bundle, { dryRun: true });
      expect(dryRun.dry_run).toBe(true);
      expect(dryRun.planned.records_to_add).toBe(1);
      expect(dryRun.planned.records_skipped_existing).toBe(1);
      expect(dryRun.planned.candidates_to_add).toBe(1);
      expect(dryRun.applied.records_added).toBe(0);

      const applied = importFromPiGovernanceBundle(dir, bundle, { dryRun: false });
      expect(applied.applied.records_added).toBe(1);
      expect(applied.applied.records_skipped_existing).toBe(1);
      expect(applied.applied.candidates_added).toBe(1);
      expect(applied.applied.tombstones_added).toBe(1);
    } finally { cleanup(dir); }
  });

  test("preserves domain scope when importing portable records", () => {
    const dir = root();
    try {
      const bundle: PiGovernanceBundle = {
        schema_version: 1,
        format: "pi-governance",
        producer: { name: "pi-governance-rs", version: "1.1.0" },
        records: [{
          id: "mem_domain",
          namespace: "default",
          layer: "l2_playbook",
          claim: "Apply only in healthcare.",
          status: "active",
          memory_kind: "instruction",
          confidence: 0.9,
          evidence_ids: [],
          scope: { level: "domain", key: "healthcare" },
          tags: ["domain"],
        }],
        patches: [], evidence: [], inquiries: [], sessions: [], reinforcement: [], events: [], tombstones: [],
        redaction: { enabled: false, fields_checked: [], fields_redacted: [], notes: [] },
      };

      importFromPiGovernanceBundle(dir, bundle, { dryRun: false, project: "fallback-project" });

      expect(loadAllRecords(dir).find((item) => item.id === "mem_domain")?.scope).toEqual({
        type: "domain",
        domains: ["healthcare"],
      });
    } finally { cleanup(dir); }
  });

  test("imports all auxiliary sections, deduplicates them, and creates a backup", () => {
    const dir = root();
    try {
      const inquiry = createInquiryRecord({ question: "Should this be retained?", context: "interop", now: "2026-06-30T00:00:00Z" });
      const reinforcement = createReinforcementEvent({ memory_id: "mem_new", outcome: "explicit_reinforcement", now: "2026-06-30T00:00:00Z" });
      const bundle: PiGovernanceBundle = {
        schema_version: 1, format: "pi-governance", producer: { name: "pi-governance-rs", version: "1.1.0" },
        records: [{ id: "mem_new", namespace: "default", layer: "l2_playbook", claim: "Retain full portable metadata.", status: "active", memory_kind: "instruction", rule_type: "workflow", confidence: 0.9, evidence_ids: ["ev_import"], tags: ["interop"], created_at: "2026-06-30", updated_at: "2026-06-30" }],
        patches: [],
        evidence: [{ id: "ev_import", resource_id: "res_demo", profile_id: "profile_demo", created_at: "2026-06-30T00:00:00Z", source_kind: "conversation", source_summary: "Imported evidence", trust_class: "direct_user_instruction", polarity: "supports", durability_signal: "project", related_memory_ids: ["mem_new"], tags: ["interop"] }],
        inquiries: [inquiry], sessions: [{ id: "session_import", namespace: "default", layer: "l3_session", text: "#decision preserve auxiliary artifacts", created_at: "2026-06-30T00:00:00Z", source_kind: "session_entry" }],
        reinforcement: [reinforcement], tombstones: [],
        redaction: { enabled: false, fields_checked: [], fields_redacted: [], notes: [] },
      };

      const first = importFromPiGovernanceBundle(dir, bundle, { dryRun: false, backup: true });
      expect(first.applied.evidence_added).toBe(1);
      expect(first.applied.inquiries_added).toBe(1);
      expect(first.applied.reinforcement_added).toBe(1);
      expect(first.applied.sessions_added).toBe(1);
      expect(readEvidenceRecords(dir)).toHaveLength(1);
      expect(readInquiryRecords(dir)).toHaveLength(1);
      expect(readReinforcementEvents(dir)).toHaveLength(1);
      expect(existsSync(join(dir, "backups"))).toBe(true);
      expect(readdirSync(join(dir, "backups")).length).toBe(1);

      const second = importFromPiGovernanceBundle(dir, bundle, { dryRun: false, backup: true });
      expect(second.applied.evidence_added).toBe(0);
      expect(second.applied.inquiries_added).toBe(0);
      expect(second.applied.reinforcement_added).toBe(0);
      expect(second.applied.sessions_added).toBe(0);
    } finally { cleanup(dir); }
  });

  test("preserves generic peer events with deduplication, backup, and redacted omission metadata", () => {
    const dir = root();
    try {
      const base: PiGovernanceBundle = {
        schema_version: 1, format: "pi-governance", producer: { name: "pi-governance-rs", version: "1.1.0" },
        records: [], patches: [], evidence: [], inquiries: [], sessions: [], reinforcement: [], tombstones: [],
        events: [{ id: "event_one", category: "peer", message: "opaque payload", nested: { value: 1 } }],
        redaction: { enabled: false, fields_checked: [], fields_redacted: [], notes: [] },
      };
      const first = importFromPiGovernanceBundle(dir, base, { dryRun: false });
      expect(first.applied.events_added).toBe(1);
      expect(readPortableEvents(dir)).toEqual(base.events!);

      const secondBundle: PiGovernanceBundle = {
        ...base,
        events: [base.events![0], base.events![0], { id: "event_two", category: "peer", message: "second" }],
      };
      const second = importFromPiGovernanceBundle(dir, secondBundle, { dryRun: false, backup: true });
      expect(second.applied.events_added).toBe(1);
      expect(readPortableEvents(dir).map((event) => event.id)).toEqual(["event_one", "event_two"]);
      expect(readFileSync(join(second.backup_path!, "memory", "portable-events.jsonl"), "utf-8")).toContain("event_one");

      const exported = exportToPiGovernanceBundle(dir);
      expect(exported.events).toEqual(readPortableEvents(dir));
      const redacted = exportToPiGovernanceBundle(dir, { redacted: true });
      expect(redacted.events).toEqual([]);
      expect(redacted.redaction.notes.join(" ")).toContain("2 opaque peer event(s) omitted");
      expect(redacted.warnings?.join(" ").toLowerCase()).toContain("opaque peer events omitted");
    } finally { cleanup(dir); }
  });

  test("imports native Rust proposed records as reviewable candidates", () => {
    const dir = root();
    try {
      const bundle = {
        schema_version: 1, format: "pi-governance", producer: { name: "pi-governance-rs", version: "1.1.0" }, records: [], evidence: [], inquiries: [], sessions: [], reinforcement: [], tombstones: [], events: [],
        patches: [
          { schema_version:1, namespace:"default", id:"patch_rust", operation:"propose_record", status:"proposed", target_id:null, contest_resolution:null, evidence:[], reason:"Review imported candidate", created_at:"2026-07-15T00:00:00Z", updated_at:"2026-07-15T00:00:00Z", proposed_record:{ id:"rec_rust", namespace:"default", class:"workflow", claim:"Use the native Rust patch payload.", evidence:[], confidence:0.8, status:"active", layer:"l2_playbook", memory_kind:"instruction", rule_type:"workflow", scope:{level:"project",key:"demo"}, tags:["interop"], supersedes:[], created_at:"2026-07-15T00:00:00Z", updated_at:"2026-07-15T00:00:00Z" } },
          { schema_version:1, namespace:"default", id:"patch_applied", operation:"propose_record", status:"applied", target_id:null, contest_resolution:null, evidence:[], reason:"Historical applied patch", created_at:"2026-07-14T00:00:00Z", updated_at:"2026-07-14T00:00:00Z", proposed_record:{ id:"rec_applied", namespace:"default", class:"workflow", claim:"Preserve applied patch history.", evidence:[], confidence:0.8, status:"active", layer:"l2_playbook", memory_kind:"instruction", rule_type:"workflow", scope:{level:"project",key:"demo"}, tags:["interop"], supersedes:[], created_at:"2026-07-14T00:00:00Z", updated_at:"2026-07-14T00:00:00Z" } }
        ],
        redaction: { enabled:false, fields_checked:[], fields_redacted:[], notes:[] }
      } as unknown as PiGovernanceBundle;
      const result = importFromPiGovernanceBundle(dir, bundle, { dryRun:false });
      expect(result.applied.candidates_added).toBe(2);
      expect(listCandidates(dir)).toEqual(expect.arrayContaining([
        expect.objectContaining({ id:"patch_rust", text:"Use the native Rust patch payload.", status:"new" }),
        expect.objectContaining({ id:"patch_applied", text:"Preserve applied patch history.", status:"patched" })
      ]));
    } finally { cleanup(dir); }
  });

  test("round-trips global and project record scope without exporting runtime capture state", () => {
    const source = root();
    const destination = root();
    try {
      unsafeAddMemoryRecord(source, record({ id: "mem_global_scope", scope: { type: "global" }, ruleType: "preference" }));
      unsafeAddMemoryRecord(source, record({ id: "mem_project_scope", scope: { type: "project", project: "project-alpha" } }));
      processCaptureTurn(source, {
        session_id: "runtime-session-private",
        turn_id: "runtime-turn-private",
        message: "Avoid promotional language in my public writing.",
        launch_cwd: "workspace/project-alpha",
        actions: [],
        resolver: () => ({ project_id: "project-alpha", display_name: "project-alpha", source: "cwd_fallback" }),
        now: "2026-07-26T00:00:00Z",
      });
      const bundle = exportToPiGovernanceBundle(source);
      expect(JSON.stringify(bundle)).not.toContain("runtime-session-private");
      expect(JSON.stringify(bundle)).not.toContain("runtime-turn-private");
      importFromPiGovernanceBundle(destination, bundle, { dryRun: false });
      expect(loadAllRecords(destination)).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "mem_global_scope", scope: { type: "global" } }),
        expect.objectContaining({ id: "mem_project_scope", scope: { type: "project", project: "project-alpha" } }),
      ]));
    } finally { cleanup(source); cleanup(destination); }
  });

  test("preserves migrated evidence, inquiry lifecycle states, and every reinforcement outcome", () => {
    const source = root();
    const destination = root();
    try {
      appendEvidenceRecord(source, { id: "ev_migrated", resource_id: "res", profile_id: "profile", created_at: "2026-07-01T00:00:00Z", source_kind: "file", source_ref: "daily/legacy.md", source_summary: "migrated", trust_class: "unknown", polarity: "supports", durability_signal: "unknown", related_memory_ids: [], notes: "legacy_evidence_backfill_v1" });
      const withdrawn = appendInquiryRecord(source, createInquiryRecord({ question: "Withdraw?", context: "test", now: "2026-07-01T00:00:00Z" }));
      const stale = appendInquiryRecord(source, createInquiryRecord({ question: "Stale?", context: "test", now: "2026-07-01T00:00:00Z" }));
      markInquiryWithdrawn(source, withdrawn.id, "2026-07-02T00:00:00Z");
      markInquiryStale(source, stale.id, "2026-07-02T00:00:00Z");
      for (const [index, outcome] of ["explicit_reinforcement", "implicit_success", "neutral_exposure", "explicit_correction"].entries()) {
        appendReinforcementEvent(source, createReinforcementEvent({ memory_id: "mem_portable", outcome: outcome as any, now: `2026-07-0${index + 1}T00:00:00Z` }));
      }
      const bundle = exportToPiGovernanceBundle(source);
      importFromPiGovernanceBundle(destination, bundle, { dryRun: false });

      expect(readEvidenceRecords(destination)[0]).toMatchObject({ notes: "legacy_evidence_backfill_v1", trust_class: "unknown", durability_signal: "unknown" });
      expect(readInquiryRecords(destination).map((item) => item.status).sort()).toEqual(["stale", "withdrawn"]);
      expect(readReinforcementEvents(destination).map((item) => item.outcome).sort()).toEqual(["explicit_correction", "explicit_reinforcement", "implicit_success", "neutral_exposure"]);
    } finally { cleanup(source); cleanup(destination); }
  });

  test("bridge defaults disabled and doctor reports standalone mode as valid", () => {
    const dir = root();
    try {
      const cfg = loadConfig(dir);
      expect(cfg.piGovernance).toEqual({ enabled: false, mode: "external", command: null, store: null, namespace: "default" });
      const report = runPiGovernanceDoctor(dir);
      expect(report.status).toBe("disabled");
      expect(report.ok).toBe(true);
      expect(report.message).toContain("standalone mode is active");
    } finally { cleanup(dir); }
  });
});
