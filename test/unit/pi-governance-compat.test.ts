import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendCandidate } from "../../src/inbox";
import { appendDailyLog } from "../../src/daily";
import { appendEvidenceRecord } from "../../src/evidence";
import { appendInquiryRecord, createInquiryRecord } from "../../src/inquiries";
import { appendDeletionTombstone, createDeletionTombstone } from "../../src/tombstones";
import { appendReinforcementEvent, createReinforcementEvent } from "../../src/reinforcement";
import { unsafeAddMemoryRecord } from "../../src/store";
import { loadConfig } from "../../src/config";
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
    profile_id: "profile_demo",
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

      const bundle = exportToPiGovernanceBundle(dir, { namespace: "interop-test", project: "demo-project", profile_id: "profile_demo" });

      expect(bundle.schema_version).toBe(1);
      expect(bundle.format).toBe("pi-governance");
      expect(bundle.producer).toEqual({ name: "pi-persistent-intelligence", version: "0.12.0" });
      expect(bundle.records.map((r) => [r.id, r.layer])).toContainEqual(["mem_l1", "l1_identity"]);
      expect(bundle.records.map((r) => [r.id, r.layer])).toContainEqual(["mem_l2", "l2_playbook"]);
      expect(bundle.sessions.map((s) => [s.layer, s.text])).toContainEqual(["l3_session", "#decision keep release namespace stable"]);
      expect(bundle.records.find((r) => r.id === "mem_l2")?.rule_type).toBe("workflow");
      expect(bundle.records.find((r) => r.id === "mem_l2")?.memory_kind).toBe("instruction");
      expect(bundle.records.find((r) => r.id === "mem_l2")?.trust_class).toBe("direct_user_instruction");
      expect(bundle.records.find((r) => r.id === "mem_l2")?.durability).toBe("project");
      expect(bundle.records.find((r) => r.id === "mem_l2")?.source_kind).toBe("manual_cli");
      expect(bundle.patches.find((p) => p.id === "cap_pending")?.status).toBe("proposed");
      expect(bundle.patches.find((p) => p.id === "cap_rejected")?.status).toBe("rejected");
      expect(bundle.evidence).toHaveLength(1);
      expect(bundle.inquiries).toHaveLength(1);
      expect(bundle.reinforcement).toHaveLength(1);
      expect(bundle.tombstones[0]).toMatchObject({ deleted_record_id: "mem_deleted", deletion_mode: "privacy_purge" });
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
