import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendEvidenceRecord, findEvidenceById } from "../../src/evidence";
import { applyPatch, readPatchFile } from "../../src/patch";
import { readRuntimeContext, buildRetrievalContext, syncFtsIndex } from "../../src/retriever";
import { renderMemoryToDisk } from "../../src/render";
import { extractHardRules } from "../../src/rules";
import { loadAllRecords, unsafeAddMemoryRecord } from "../../src/store";
import { isTombstonedRecord, readDeletionTombstones } from "../../src/tombstones";
import { MemoryFtsIndex } from "../../src/search/fts";
import { runMemoryDiagnostics } from "../../src/diagnostics";
import { recoverGovernanceTransactions } from "../../src/governance-recovery";
import type { EvidenceRecord, MemoryPatch, MemoryRecord } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-delete-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem_delete",
    layer: "L2",
    scope: { type: "global" },
    tags: ["correction"],
    statement: "Never expose secret token abc123.",
    evidence: [{ type: "manual", ref: "daily", note: "secret token abc123" }],
    confidence: 0.95,
    stability: "semi-stable",
    created_at: "2026-05-19",
    updated_at: "2026-05-19",
    review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "avoid_pattern",
    ...overrides,
  };
}

function evidence(id = "ev_1"): EvidenceRecord {
  return {
    id,
    resource_id: "user:test",
    profile_id: "project:test",
    created_at: "2026-05-19T10:00:00.000Z",
    source_kind: "conversation",
    source_ref: "message",
    source_summary: "secret token abc123 was mentioned",
    source_excerpt: "Never expose secret token abc123.",
    trust_class: "direct_user_instruction",
    polarity: "supports",
    related_memory_ids: ["mem_delete"],
  };
}

function patch(mode: "audit_preserving" | "privacy_purge"): MemoryPatch {
  return {
    patch_id: `patch_${mode}`,
    created_at: "2026-05-19T10:00:00.000Z",
    generated_by: "manual",
    mode: "propose",
    summary: "delete",
    ops: [{ op_id: "op_001", op: "delete", target_id: "mem_delete", deletion_mode: mode, deletion_reason: mode === "privacy_purge" ? "privacy_sensitive" : "invalid", reason: "delete test", risk: "high", default_selected: true }],
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}

describe("delete patch", () => {
  test("audit_preserving tombstones and excludes deleted records from retrieval/projection/hard rules", async () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    applyPatch(dir, patch("audit_preserving"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });

    const deleted = loadAllRecords(dir).find((item) => item.id === "mem_delete");
    expect(deleted?.status).toBe("deleted");
    expect(deleted?.statement).toContain("secret token");
    expect(isTombstonedRecord(dir, "mem_delete")).toBe(true);
    expect(extractHardRules(loadAllRecords(dir))).toHaveLength(0);

    const rendered = renderMemoryToDisk(dir);
    expect(rendered).not.toContain("secret token");

    const ctx = await buildRetrievalContext(dir, { prompt: "secret token", today: "2026-05-19", cwd: dir });
    expect(ctx.markdown).not.toContain("secret token");
    expect(readRuntimeContext(dir)).not.toContain("secret token");
  });

  test("privacy_purge removes a superseded terminal record while audit_preserving still rejects it", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record({ status: "superseded", scope: { type: "project", project: "secret-project-token" }, superseded_by: ["mem_replacement"] }));
    const audit = applyPatch(dir, patch("audit_preserving"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });
    expect(audit.skipped_ops).toContainEqual(expect.objectContaining({ op_id: "op_001", reason: "target_terminal" }));

    const purged = applyPatch(dir, patch("privacy_purge"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:01:00.000Z" });
    expect(purged.applied_ops).toEqual(["op_001"]);
    const deleted = loadAllRecords(dir).find((item) => item.id === "mem_delete");
    expect(deleted).toMatchObject({ status: "deleted", statement: "[deleted]", evidence: [expect.objectContaining({ type: "deletion" })] });
    expect(JSON.stringify(deleted)).not.toContain("secret token");
    expect(JSON.stringify(deleted)).not.toContain("secret-project-token");
    expect(readFileSync(ensureMemoryDirs(dir).memory.tombstones, "utf-8")).not.toContain("secret-project-token");
    expect(readDeletionTombstones(dir)[0]).toMatchObject({ deleted_record_id: "mem_delete", deletion_mode: "privacy_purge", content_removed: true });
    unsafeAddMemoryRecord(dir, record({ id: "mem_replacement", statement: "Safe replacement.", status: "active", supersedes: ["mem_delete"], superseded_by: [] }));
    renderMemoryToDisk(dir);
    expect(runMemoryDiagnostics(dir).findings.filter((finding) => finding.severity === "error")).toEqual([]);
  });

  test("privacy_purge also redacts correlated historical candidates and patch payloads", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    applyPatch(dir, patch("privacy_purge"), { selectedOpIds: ["op_001"], now: "2026-05-19T09:30:00.000Z" });
    const paths = ensureMemoryDirs(dir);
    const secret = "API_TOKEN=legacy-secret-value";
    writeFileSync(paths.inbox.captured, `${JSON.stringify({
      id: "candidate_arbitrary",
      created_at: "2026-05-19T09:00:00.000Z",
      source: { type: "manual", ref: "daily", cwd: "/secret/scope" },
      text: secret,
      tags: ["secret-tag"],
      evidence_refs: ["secret-evidence"],
      confidence: 0.9,
      status: "patched",
    })}\n${JSON.stringify({
      id: "candidate_direct_relationship",
      created_at: "2026-05-19T09:00:00.000Z",
      source: { type: "manual", ref: "daily" },
      text: secret,
      tags: ["secret-tag"],
      evidence_refs: ["secret-evidence"],
      matched_memory_ids: ["mem_delete"],
      status: "new",
    })}\n`);
    writeFileSync(join(paths.patches, "patch_historical.json"), `${JSON.stringify({
      patch_id: "patch_historical",
      created_at: "2026-05-19T09:00:00.000Z",
      generated_by: "curator",
      mode: "propose",
      summary: secret,
      ops: [{
        op_id: "op_historical",
        candidate_id: "candidate_arbitrary",
        op: "add",
        target: "memory/L2.playbooks.jsonl",
        record: record({ statement: secret }),
        rationale: secret,
        risk: "low",
        default_selected: true,
      }, {
        op_id: "op_sibling",
        candidate_id: "candidate_arbitrary",
        op: "flag_for_review",
        target_id: "unrelated_record",
        updates: { review: { cadence_days: 1, next_review: "2026-05-20", change_condition: secret } },
        rationale: secret,
        risk: "low",
        default_selected: false,
      }, {
        op_id: "op_relationship_only",
        candidate_id: "candidate_direct_relationship",
        op: "add",
        record: record({ id: "relationship_only_record", statement: secret }),
        rationale: secret,
        risk: "low",
        default_selected: false,
      }],
      status: "applied",
      applied_at: "2026-05-19T09:01:00.000Z",
      applied_ops: ["op_historical"],
      skipped_ops: [],
    }, null, 2)}\n`);

    const current = patch("privacy_purge");
    current.summary = secret;
    current.ops[0].reason = secret;
    current.ops.push({
      op_id: "op_reintroduce",
      candidate_id: "candidate_direct_relationship",
      op: "add",
      record: record({ id: "mem_reintroduced", statement: secret }),
      rationale: secret,
      risk: "low",
      default_selected: true,
    });
    const applied = applyPatch(dir, current, { selectedOpIds: ["op_001", "op_reintroduce"], now: "2026-05-19T10:00:00.000Z" });

    expect(applied.summary).toBe("[privacy purged]");
    expect(JSON.stringify(applied)).not.toContain(secret);
    expect(readFileSync(join(paths.patches, "patch_privacy_purge.json"), "utf-8")).not.toContain(secret);
    expect(readFileSync(paths.inbox.captured, "utf-8")).not.toContain(secret);
    expect(readFileSync(join(paths.patches, "patch_historical.json"), "utf-8")).not.toContain(secret);
    expect(readFileSync(paths.inbox.captured, "utf-8")).toContain("[privacy purged]");
    expect(readFileSync(join(paths.patches, "patch_historical.json"), "utf-8")).toContain("[privacy purged]");
    expect(loadAllRecords(dir).some((item) => item.id === "mem_reintroduced")).toBe(false);

    unsafeAddMemoryRecord(dir, record({ id: "unrelated_record", statement: "Unrelated safe record." }));
    const shell = readPatchFile(dir, "patch_historical");
    applyPatch(dir, shell, { selectedOpIds: ["op_sibling"], now: "2026-05-19T10:05:00.000Z" });
    expect(loadAllRecords(dir).find((item) => item.id === "unrelated_record")?.statement).toBe("Unrelated safe record.");
  });

  test("privacy purge redacts nested immutable attempt receipts as well as the latest patch", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const privateValue = "API_TOKEN=selection-receipt-private-value";
    const update: MemoryPatch = {
      ...patch("audit_preserving"),
      patch_id: "patch_private_receipt_update",
      ops: [{
        op_id: "op_update", op: "update", target_id: "mem_delete",
        updates: { review: {
          cadence_days: 30, next_review: "2026-06-18",
          change_condition: privateValue,
        } },
        risk: "low", default_selected: true,
      }],
    };
    const updated = applyPatch(dir, update, {
      selectedOpIds: ["op_update"], now: "2026-05-19T09:30:00.000Z",
    });
    expect(updated.applied_ops).toEqual(["op_update"]);
    const paths = ensureMemoryDirs(dir);
    const receipts = join(paths.patches, "receipts");
    const before = readdirSync(receipts);
    expect(before).toHaveLength(1);
    expect(readFileSync(join(receipts, before[0]!), "utf8")).toContain(privateValue);
    expect(readFileSync(join(paths.patches, "patch_private_receipt_update.json"), "utf8"))
      .toContain(privateValue);

    const purged = applyPatch(dir, patch("privacy_purge"), {
      selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z",
    });
    expect(purged.applied_ops).toEqual(["op_001"]);
    const after = readdirSync(receipts);
    expect(after.length).toBeGreaterThanOrEqual(2);
    for (const name of after) {
      const content = readFileSync(join(receipts, name), "utf8");
      expect(content).not.toContain(privateValue);
      expect(JSON.parse(content).patch_id).toBeTruthy();
    }
    expect(readFileSync(join(paths.patches, "patch_private_receipt_update.json"), "utf8"))
      .not.toContain(privateValue);
    expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("deleted");
  });

  test("privacy purge redacts completed governance manifest results and replay cannot reveal their private payload", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const secret = "PRIVATE_MANIFEST_MARKER_57982";
    const update: MemoryPatch = {
      ...patch("audit_preserving"), patch_id: "patch_manifest_secret_update",
      ops: [{
        op_id: "op_update", op: "update", target_id: "mem_delete",
        updates: { review: { cadence_days: 30, next_review: "2026-06-18", change_condition: secret } },
        risk: "low", default_selected: true,
      }],
    };
    const result = applyPatch(dir, update, {
      selectedOpIds: ["op_update"], now: "2026-05-19T09:30:00.000Z",
    });
    expect(result.applied_ops).toEqual(["op_update"]);
    const secondUpdate: MemoryPatch = {
      ...update, patch_id: "patch_manifest_secret_update_second",
      ops: [{
        ...update.ops[0]!, op_id: "op_update_second",
        updates: { review: { cadence_days: 31, next_review: "2026-06-19", change_condition: secret } },
      }],
    };
    expect(applyPatch(dir, secondUpdate, {
      selectedOpIds: ["op_update_second"], now: "2026-05-19T09:31:00.000Z",
    }).applied_ops).toEqual(["op_update_second"]);
    const txRoot = ensureMemoryDirs(dir).governance.transactions;
    const before = readdirSync(txRoot);
    expect(before).toHaveLength(2);
    const earlier = join(txRoot, before[0]!, "intent.json");
    for (const id of before) {
      expect(readFileSync(join(txRoot, id, "intent.json"), "utf8")).toContain(secret);
    }

    const purge = applyPatch(dir, patch("privacy_purge"), {
      selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z",
    });
    expect(purge.applied_ops).toEqual(["op_001"]);
    for (const id of readdirSync(txRoot)) {
      const original = readFileSync(join(txRoot, id, "intent.json"), "utf8");
      expect(original).not.toContain(secret);
      expect(JSON.parse(original).stage).toBe("complete");
    }
    expect(JSON.parse(readFileSync(earlier, "utf8")).result.ops[0].op).toBe("reject_candidate");
    const replay = applyPatch(dir, update, {
      selectedOpIds: ["op_update"], now: "2026-05-19T10:01:00.000Z",
    });
    const replay2 = applyPatch(dir, secondUpdate, {
      selectedOpIds: ["op_update_second"], now: "2026-05-19T10:01:01.000Z",
    });
    expect(replay.applied_ops).toEqual([]);
    expect(replay2.applied_ops).toEqual([]);
    expect(JSON.stringify(replay)).not.toContain(secret);
    expect(JSON.stringify(replay2)).not.toContain(secret);
    expect(readFileSync(join(ensureMemoryDirs(dir).patches, update.patch_id + ".json"), "utf8")).not.toContain(secret);
    expect(readFileSync(join(ensureMemoryDirs(dir).patches, secondUpdate.patch_id + ".json"), "utf8")).not.toContain(secret);
    expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("deleted");
    expect(readdirSync(txRoot)).toHaveLength(3);
  });

  test("completed historical workspace and orphan intent temp cannot retain payload after privacy purge", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const secret = "PRIVATE_ORPHAN_WORKSPACE_MARKER_856";
    const prior: MemoryPatch = {
      ...patch("audit_preserving"), patch_id: "patch_prior_workspace",
      ops: [{
        op_id: "op_update", op: "update", target_id: "mem_delete",
        updates: { review: {
          cadence_days: 30, next_review: "2026-06-18",
          change_condition: secret,
        } },
        risk: "low", default_selected: true,
      }],
    };
    expect(applyPatch(dir, prior, {
      selectedOpIds: ["op_update"], now: "2026-05-19T09:30:00.000Z",
    }).applied_ops).toEqual(["op_update"]);
    const txRoot = ensureMemoryDirs(dir).governance.transactions;
    const oldId = readdirSync(txRoot)[0]!;
    const folder = join(txRoot, oldId);
    const staleWorkspace = join(folder, "workspace");
    mkdirSync(staleWorkspace);
    writeFileSync(join(staleWorkspace, "stale-original.txt"), secret);
    const strayTemp = join(folder, "intent.json.tmp-99999-1-abcdef");
    writeFileSync(strayTemp, secret);
    const originalManifest = join(folder, "intent.json");
    expect(readFileSync(originalManifest, "utf8")).toContain(secret);

    const result = applyPatch(dir, patch("privacy_purge"), {
      selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z",
    });
    expect(result.applied_ops).toEqual(["op_001"]);
    expect(existsSync(staleWorkspace)).toBe(false);
    expect(existsSync(strayTemp)).toBe(false);
    expect(readFileSync(originalManifest, "utf8")).not.toContain(secret);
    expect(loadAllRecords(dir).find((record) => record.id === "mem_delete")?.status).toBe("deleted");
  });

  test("privacy purge also removes sensitive skipped-operation details from historical manifests", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const secret = "PRIVATE_SKIP_DETAIL_MARKER_7921";
    const proposal: MemoryPatch = {
      ...patch("audit_preserving"), patch_id: "patch_historical_skipped_detail",
      ops: [
        { op_id: "op_selected", op: "update", target_id: "mem_delete",
          updates: { review: { cadence_days: 35, next_review: "2026-06-23", change_condition: secret } },
          risk: "low", default_selected: false },
        { op_id: "op_unselected", op: "update", target_id: "mem_delete",
          updates: { review: { cadence_days: 36, next_review: "2026-06-24", change_condition: secret } },
          risk: "low", default_selected: false },
      ],
    };
    applyPatch(dir, proposal, {
      selectedOpIds: ["op_selected"], now: "2026-05-19T09:30:00.000Z",
    });
    const transactions = ensureMemoryDirs(dir).governance.transactions;
    const oldId = readdirSync(transactions)[0]!;
    const manifestPath = join(transactions, oldId, "intent.json");
    const historic = JSON.parse(readFileSync(manifestPath, "utf8"));
    historic.result.skipped_ops[0].detail = secret;
    writeFileSync(manifestPath, JSON.stringify(historic, null, 2) + "\n");
    expect(readFileSync(manifestPath, "utf8")).toContain(secret);

    const purged = applyPatch(dir, patch("privacy_purge"), {
      selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z",
    });
    expect(purged.applied_ops).toEqual(["op_001"]);
    const after = readFileSync(manifestPath, "utf8");
    expect(after).not.toContain(secret);
    expect(JSON.parse(after).result.skipped_ops[0].detail).toBe("[privacy purged]");
    expect(loadAllRecords(dir).find((r) => r.id === "mem_delete")?.status).toBe("deleted");
  });

  test("recovering interrupted privacy purge completes historical manifest redaction without resurrecting content", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const secret = "PRIVATE_RECOVERY_MANIFEST_MARKER_951";
    const update: MemoryPatch = {
      ...patch("audit_preserving"), patch_id: "patch_manifest_recovery_fixture",
      ops: [{
        op_id: "op_update", op: "update", target_id: "mem_delete",
        updates: { review: { cadence_days: 30, next_review: "2026-06-18", change_condition: secret } },
        risk: "low", default_selected: true,
      }],
    };
    applyPatch(dir, update, { selectedOpIds: ["op_update"], now: "2026-05-19T09:30:00.000Z" });
    const transactionRoot = ensureMemoryDirs(dir).governance.transactions;
    const firstId = readdirSync(transactionRoot)[0]!;
    const historical = join(transactionRoot, firstId);
    const orphan = join(historical, "workspace");
    mkdirSync(orphan);
    writeFileSync(join(orphan, "private.txt"), secret);
    const orphanTemp = join(historical, "intent.json.tmp-111-222-333");
    writeFileSync(orphanTemp, secret);
    expect(() => applyPatch(dir, patch("privacy_purge"), {
      selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z",
      faultAfterStage: "intent_written",
    })).toThrow();
    expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("active");
    const report = recoverGovernanceTransactions(dir, "2026-05-19T10:01:00.000Z");
    expect(report.blocked).toEqual([]);
    expect(report.completed).toHaveLength(1);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(orphanTemp)).toBe(false);
    const txRoot = ensureMemoryDirs(dir).governance.transactions;
    for (const id of readdirSync(txRoot)) {
      const raw = readFileSync(join(txRoot, id, "intent.json"), "utf8");
      expect(raw).not.toContain(secret);
      expect(JSON.parse(raw).stage).toBe("complete");
    }
    expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("deleted");
    const replay = applyPatch(dir, update, {
      selectedOpIds: ["op_update"], now: "2026-05-19T10:02:00.000Z",
    });
    expect(JSON.stringify(replay)).not.toContain(secret);
  });

  test("privacy purge fault before durable intent leaves historical manifests and canonical source unchanged", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const secret = "PRIVACY_PREINTENT_ABORT_MARKER_873";
    const update: MemoryPatch = {
      ...patch("audit_preserving"), patch_id: "patch_manifest_abort_fixture",
      ops: [{
        op_id: "op_update", op: "update", target_id: "mem_delete",
        updates: { review: { cadence_days: 30, next_review: "2026-06-18", change_condition: secret } },
        risk: "low", default_selected: true,
      }],
    };
    applyPatch(dir, update, { selectedOpIds: ["op_update"], now: "2026-05-19T09:30:00.000Z" });
    const txRoot = ensureMemoryDirs(dir).governance.transactions;
    const [originalId] = readdirSync(txRoot);
    const originalManifest = join(txRoot, originalId!, "intent.json");
    const before = readFileSync(originalManifest, "utf8");
    expect(before).toContain(secret);
    expect(() => applyPatch(dir, patch("privacy_purge"), {
      selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z",
      faultAfterStage: "staged",
    })).toThrow();
    expect(readFileSync(originalManifest, "utf8")).toBe(before);
    expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("active");
    expect(readdirSync(txRoot)).toEqual([originalId]);
  });

  test("a malformed historical governance manifest blocks privacy purge without redacting unrelated live artifacts", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const badId = "patch_bad_privacy_manifest";
    const txDir = join(ensureMemoryDirs(dir).governance.transactions, badId);
    mkdirSync(txDir, { recursive: true });
    writeFileSync(join(txDir, "intent.json"), JSON.stringify({
      transaction_id: badId, stage: "complete",
      expected_generation: 0, next_generation: 1,
      created_at: "2026-05-19T09:00:00.000Z",
    }));
    expect(() => applyPatch(dir, patch("privacy_purge"), {
      selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z",
    })).toThrow(/Incomplete or invalid governance manifest/);
    expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("active");
  });

  test("missing privacy working snapshot blocks recovery before historical publication", () => {
    for (const deletion of ["file", "directory"] as const) {
      const dir = root();
      unsafeAddMemoryRecord(dir, record());
      const privateValue = "MISSING_SNAPSHOT_PRIVATE_VALUE_913";
      const prior: MemoryPatch = {
        ...patch("audit_preserving"), patch_id: "patch_missing_snapshot_" + deletion,
        ops: [{
          op_id: "op_sensitive_update", op: "update", target_id: "mem_delete",
          updates: { review: {
            cadence_days: 30, next_review: "2026-06-18", change_condition: privateValue,
          } },
          risk: "low", default_selected: true,
        }],
      };
      applyPatch(dir, prior, { now: "2026-05-19T09:30:00.000Z" });
      const rootTransactions = ensureMemoryDirs(dir).governance.transactions;
      const historicalId = readdirSync(rootTransactions)[0]!;
      const historicFile = join(rootTransactions, historicalId, "intent.json");
      const historicOriginal = readFileSync(historicFile, "utf8");
      expect(() => applyPatch(dir, patch("privacy_purge"), {
        selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z",
        faultAfterStage: "intent_written",
      })).toThrow();
      const pendingId = readdirSync(rootTransactions).find((id) => id !== historicalId)!;
      const workingDir = join(rootTransactions, pendingId, "workspace",
        "governance-manifest-snapshots", "working");
      if (deletion === "directory") rmSync(workingDir, { recursive: true, force: true });
      else rmSync(join(workingDir, historicalId + ".json"));
      const recovered = recoverGovernanceTransactions(dir, "2026-05-19T10:01:00.000Z");
      expect(recovered.completed).toEqual([]);
      expect(recovered.blocked.some((item) => item.transaction_id === pendingId)).toBe(true);
      expect(readFileSync(historicFile, "utf8")).toBe(historicOriginal);
      expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("active");
    }
  });

  test("recovery does not discard a missing historical intent while a durable privacy purge is pending", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const prior: MemoryPatch = {
      ...patch("audit_preserving"), patch_id: "patch_privacy_missing_recovery_intent",
      ops: [{
        op_id: "op_sensitive", op: "update", target_id: "mem_delete",
        updates: { review: {
          cadence_days: 30, next_review: "2026-06-18",
          change_condition: "HISTORICAL_MISSING_RECOVERY_MARKER",
        } },
        risk: "low", default_selected: true,
      }],
    };
    applyPatch(dir, prior, { now: "2026-05-19T09:30:00.000Z" });
    const txRoot = ensureMemoryDirs(dir).governance.transactions;
    const historicalId = readdirSync(txRoot)[0]!;
    expect(() => applyPatch(dir, patch("privacy_purge"), {
      selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z",
      faultAfterStage: "intent_written",
    })).toThrow();
    const activePurgeId = readdirSync(txRoot).find((id) => id !== historicalId)!;
    rmSync(join(txRoot, historicalId, "intent.json"));
    const recovered = recoverGovernanceTransactions(dir, "2026-05-19T10:01:00.000Z");
    expect(recovered.completed).toHaveLength(0);
    expect(recovered.discarded).toHaveLength(0);
    expect(recovered.blocked.some((item) => item.transaction_id === activePurgeId)).toBe(true);
    expect(existsSync(join(txRoot, historicalId))).toBe(true);
    expect(existsSync(join(txRoot, activePurgeId, "workspace"))).toBe(true);
    expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("active");
  });

  test("durable privacy snapshot commitment rejects byte-valid unredacted working snapshot reversion", () => {
    for (const mutated of ["working-original", "working-valid-json", "original-valid-json"] as const) {
      const dir = root();
      unsafeAddMemoryRecord(dir, record());
      const secret = "PRIVACY_COMMITTED_SNAPSHOT_MARKER_506";
      const prior: MemoryPatch = {
        ...patch("audit_preserving"),
        patch_id: "patch_commitment_historical_" + mutated,
        ops: [{
          op_id: "op_historical_update", op: "update", target_id: "mem_delete",
          updates: { review: {
            cadence_days: 32, next_review: "2026-06-20",
            change_condition: secret,
          } }, risk: "low", default_selected: true,
        }],
      };
      expect(applyPatch(dir, prior, { now: "2026-05-19T09:30:00.000Z" }).applied_ops)
        .toEqual(["op_historical_update"]);
      const transactions = ensureMemoryDirs(dir).governance.transactions;
      const historicId = readdirSync(transactions)[0]!;
      const originalHistoricalManifest = readFileSync(join(transactions, historicId, "intent.json"), "utf8");
      expect(originalHistoricalManifest).toContain(secret);
      expect(() => applyPatch(dir, patch("privacy_purge"), {
        selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z",
        faultAfterStage: "intent_written",
      })).toThrow();
      const purgeId = readdirSync(transactions).find((id) => id !== historicId)!;
      const intentFile = join(transactions, purgeId, "intent.json");
      const durable = JSON.parse(readFileSync(intentFile, "utf8"));
      expect(durable.stage).toBe("intent_written");
      expect(durable.privacy_manifest_snapshot).toBe(true);
      expect(durable.privacy_snapshot_commitment.original).toMatch(/^[a-f0-9]{64}$/);
      expect(durable.privacy_snapshot_commitment.working).toMatch(/^[a-f0-9]{64}$/);

      const snapshots = join(transactions, purgeId, "workspace",
        "governance-manifest-snapshots");
      const original = join(snapshots, "original", historicId + ".json");
      const working = join(snapshots, "working", historicId + ".json");
      const originalBytes = readFileSync(original, "utf8");
      expect(originalBytes).toContain(secret);
      const workingBytes = readFileSync(working, "utf8");
      expect(workingBytes).not.toContain(secret);

      if (mutated === "working-original") writeFileSync(working, originalBytes);
      if (mutated === "working-valid-json") {
        const parsed = JSON.parse(workingBytes);
        parsed.updated_at = "2026-05-19T10:00:01.000Z";
        writeFileSync(working, JSON.stringify(parsed, null, 2) + "\n");
      }
      if (mutated === "original-valid-json") {
        const parsed = JSON.parse(originalBytes);
        parsed.updated_at = "2026-05-19T09:30:01.000Z";
        writeFileSync(original, JSON.stringify(parsed, null, 2) + "\n");
      }

      const report = recoverGovernanceTransactions(dir, "2026-05-19T10:01:00.000Z");
      expect(report.completed).toEqual([]);
      expect(report.blocked.some((item) =>
        item.transaction_id === purgeId
        && /snapshot bytes differ/.test(item.reason))).toBe(true);
      expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("active");
      expect(readFileSync(join(transactions, historicId, "intent.json"), "utf8"))
        .toBe(originalHistoricalManifest);
      expect(existsSync(join(transactions, purgeId, "workspace"))).toBe(true);
      expect(durable.privacy_snapshot_commitment)
        .toEqual(JSON.parse(readFileSync(intentFile, "utf8")).privacy_snapshot_commitment);
    }
  });

  test("unknown historical backups, missing intents and symlink transaction directories fail closed before purge", () => {
    for (const defect of ["backup", "missing-intent", "symlink-directory"] as const) {
      const dir = root();
      unsafeAddMemoryRecord(dir, record());
      const prior: MemoryPatch = {
        ...patch("audit_preserving"), patch_id: "patch_historical_integrity_" + defect,
        ops: [{
          op_id: "op_old_update", op: "update", target_id: "mem_delete",
          updates: { review: {
            cadence_days: 30, next_review: "2026-06-18",
            change_condition: "PRIVATE_HISTORICAL_INTEGRITY_FIXTURE",
          } },
          risk: "low", default_selected: true,
        }],
      };
      applyPatch(dir, prior, { now: "2026-05-19T09:30:00.000Z" });
      const transactionRoot = ensureMemoryDirs(dir).governance.transactions;
      const oldId = readdirSync(transactionRoot)[0]!;
      if (defect === "backup") {
        writeFileSync(join(transactionRoot, oldId, "intent.json.backup"), "PRIVATE_HISTORICAL_INTEGRITY_FIXTURE");
      } else if (defect === "missing-intent") {
        rmSync(join(transactionRoot, oldId, "intent.json"));
      } else {
        symlinkSync(join(transactionRoot, oldId), join(transactionRoot, "shadow_alias"), "dir");
      }
      expect(() => applyPatch(dir, patch("privacy_purge"), {
        selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z",
      })).toThrow();
      expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("active");
      if (defect === "missing-intent") {
        expect(existsSync(join(transactionRoot, oldId))).toBe(true);
      }
    }
  });

  test("executes multiple selected privacy deletes even when they share a candidate", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    unsafeAddMemoryRecord(dir, record({ id: "mem_second", statement: "Second private record." }));
    const multi = patch("privacy_purge");
    multi.ops[0].candidate_id = "candidate_shared";
    multi.ops.push({
      op_id: "op_002",
      op: "delete",
      target_id: "mem_second",
      candidate_id: "candidate_shared",
      deletion_mode: "privacy_purge",
      deletion_reason: "privacy_sensitive",
      reason: "privacy cleanup",
      risk: "high",
      default_selected: true,
    });

    applyPatch(dir, multi, { selectedOpIds: ["op_001", "op_002"], now: "2026-05-19T10:00:00.000Z" });

    expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("deleted");
    expect(loadAllRecords(dir).find((item) => item.id === "mem_second")?.status).toBe("deleted");
  });

  test("preflights historical artifacts before a privacy mutation", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const paths = ensureMemoryDirs(dir);
    writeFileSync(join(paths.patches, "malformed.json"), `${JSON.stringify({ patch_id: "malformed", ops: [] })}\n`);
    writeFileSync(paths.inbox.captured, `${JSON.stringify({
      id: "bad_candidate",
      created_at: "2026-05-19T09:00:00.000Z",
      text: "safe",
      tags: [],
      evidence_refs: [],
      matched_memory_ids: "mem_delete",
      status: "new",
    })}\n`);

    expect(() => applyPatch(dir, patch("privacy_purge"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" })).toThrow();
    expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("active");
    expect(existsSync(join(paths.patches, "patch_privacy_purge.json"))).toBe(false);
  });

  test("rejects patch IDs containing path components before writing or mutating", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    const malicious = patch("privacy_purge");
    malicious.patch_id = "../escaped";

    expect(() => applyPatch(dir, malicious, { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" })).toThrow("Invalid patch ID");
    expect(existsSync(join(dir, "escaped.json"))).toBe(false);
    expect(loadAllRecords(dir).find((item) => item.id === "mem_delete")?.status).toBe("active");
  });

  test("privacy_purge removes normal record content and redacts linked evidence", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    appendEvidenceRecord(dir, evidence());
    applyPatch(dir, patch("privacy_purge"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });

    const purged = loadAllRecords(dir).find((item) => item.id === "mem_delete");
    expect(purged?.status).toBe("deleted");
    expect(purged?.statement).toBe("[deleted]");
    expect(JSON.stringify(purged)).not.toContain("abc123");
    expect(readDeletionTombstones(dir)[0].content_removed).toBe(true);

    const redacted = findEvidenceById(dir, "ev_1");
    expect(redacted?.redaction_status).toBe("deleted");
    expect(redacted?.source_summary).toBe("[deleted]");
    expect(redacted?.source_excerpt).toBeUndefined();
    expect(JSON.stringify(redacted)).not.toContain("abc123");
  });

  test("tombstoned record cannot be re-added through patch apply", () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, record());
    applyPatch(dir, patch("privacy_purge"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });

    const result = applyPatch(dir, {
      patch_id: "patch_readd",
      created_at: "2026-05-19T10:00:00.000Z",
      generated_by: "manual",
      mode: "propose",
      summary: "readd",
      ops: [{ op_id: "op_001", op: "add", record: record(), risk: "low", default_selected: true }],
      status: "proposed",
      applied_at: null,
      applied_ops: [],
      skipped_ops: [],
    }, { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });
    expect(result.applied_ops).toEqual([]);
    expect(result.skipped_ops).toContainEqual(expect.objectContaining({ op_id: "op_001", reason: "tombstoned" }));
  });

  test("search index rebuild excludes deleted records", () => {
    const dir = root();
    const fts = new MemoryFtsIndex(join(dir, "search", "memory-fts.db"));
    unsafeAddMemoryRecord(dir, record());
    syncFtsIndex(dir, fts);
    expect(fts.search("secret", 5)).toHaveLength(1);
    applyPatch(dir, patch("audit_preserving"), { selectedOpIds: ["op_001"], now: "2026-05-19T10:00:00.000Z" });
    syncFtsIndex(dir, fts);
    expect(fts.search("secret", 5)).toHaveLength(0);
    fts.close();
    expect(existsSync(join(dir, "rendered", "MEMORY.md"))).toBe(true);
    expect(readFileSync(join(dir, "rendered", "MEMORY.md"), "utf-8")).not.toContain("secret token");
  });
});
