import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addMemoryRecordFromPatch, loadAllRecords, PATCH_APPLY_CONTEXT, updateMemoryRecord } from "./store";
import { updateCandidateStatus } from "./inbox";
import { renderMemoryToDisk } from "./render";
import { ensureMemoryDirs } from "./paths";
import { writeVaultPromotionReport } from "./vaultPromotion";
import { createDeletionTombstone, appendDeletionTombstone, isTombstonedRecord } from "./tombstones";
import { readEvidenceRecords, redactEvidenceForMemory } from "./evidence";
import { runPostMutationChecks } from "./post-mutation-checks";
import type { MemoryPatch, PatchOp } from "./types";

export interface ApplyPatchOptions {
  selectedOpIds?: string[];
  now: string;
}

function isSelected(op: PatchOp, selected?: string[]): boolean {
  return selected ? selected.includes(op.op_id) : op.default_selected;
}

function mergeUnique(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
  const merged = [...new Set([...(existing ?? []), ...(incoming ?? [])])];
  return merged.length ? merged : undefined;
}

function hasInvalidatedEvidence(root: string, op: PatchOp): boolean {
  const ids = new Set([...(op.record?.evidence ?? []), ...(op.to_record?.evidence ?? [])].map((ev) => ev.ref));
  if (ids.size === 0) return false;
  return readEvidenceRecords(root).some((ev) => ids.has(ev.id) && (ev.redaction_status === "redacted" || ev.redaction_status === "deleted"));
}

function canApplyOp(root: string, op: PatchOp): boolean {
  const records = loadAllRecords(root);
  const byId = new Map(records.map((record) => [record.id, record]));
  if (op.record && byId.has(op.record.id)) return false;
  if ((op.record || op.to_record) && hasInvalidatedEvidence(root, op)) return false;
  if (op.target_id && isTombstonedRecord(root, op.target_id)) return false;
  if (op.op === "add") return op.record ? !isTombstonedRecord(root, op.record.id) : false;
  if (["update", "update_stability", "flag_for_review", "decay", "deprecate", "contest", "uncontest", "add_exception"].includes(op.op)) {
    const target = op.target_id ? byId.get(op.target_id) : undefined;
    return Boolean(target && target.status !== "deleted" && target.status !== "superseded");
  }
  if (op.op === "supersede") {
    const target = op.target_id ? byId.get(op.target_id) : undefined;
    return Boolean(target && target.status !== "deleted" && target.status !== "superseded" && op.to_record && !byId.has(op.to_record.id));
  }
  if (op.op === "delete") {
    const target = op.target_id ? byId.get(op.target_id) : undefined;
    return Boolean(target && target.status !== "deleted");
  }
  return true;
}

function applyOp(root: string, patchId: string, op: PatchOp, now: string): void {
  if (op.op === "add") {
    if (!op.record) throw new Error(`Patch op ${op.op_id} missing record`);
    addMemoryRecordFromPatch(root, op.record);
    if (op.candidate_id) updateCandidateStatus(root, op.candidate_id, "patched");
    return;
  }

  if (op.op === "decay" || op.op === "update" || op.op === "update_stability") {
    if (!op.target_id || !op.updates) throw new Error(`Patch op ${op.op_id} missing update fields`);
    updateMemoryRecord(root, op.target_id, (record) => ({ ...record, ...op.updates }), PATCH_APPLY_CONTEXT);
    return;
  }

  if (op.op === "flag_for_review") {
    if (!op.target_id || !op.updates) throw new Error(`Patch op ${op.op_id} missing update fields`);
    updateMemoryRecord(root, op.target_id, (record) => ({ ...record, ...op.updates }), PATCH_APPLY_CONTEXT);
    return;
  }

  if (op.op === "deprecate") {
    if (!op.target_id) throw new Error(`Patch op ${op.op_id} missing target_id`);
    updateMemoryRecord(root, op.target_id, (record) => ({ ...record, status: "deprecated", updated_at: now.slice(0, 10) }), PATCH_APPLY_CONTEXT);
    return;
  }

  if (op.op === "contest" || op.op === "uncontest") {
    if (!op.target_id) throw new Error(`Patch op ${op.op_id} missing target_id`);
    updateMemoryRecord(root, op.target_id, (record) => ({
      ...record,
      status: op.op === "contest" ? "contested" : "active",
      evidence: op.reason ? [...record.evidence, { type: "manual", ref: patchId, note: op.reason }] : record.evidence,
      updated_at: now.slice(0, 10),
    }), PATCH_APPLY_CONTEXT);
    return;
  }

  if (op.op === "add_exception") {
    if (!op.target_id || !op.updates) throw new Error(`Patch op ${op.op_id} missing exception fields`);
    updateMemoryRecord(root, op.target_id, (record) => ({
      ...record,
      applies_when: mergeUnique(record.applies_when, op.updates?.applies_when),
      does_not_apply_when: mergeUnique(record.does_not_apply_when, op.updates?.does_not_apply_when),
      known_exceptions: mergeUnique(record.known_exceptions, op.updates?.known_exceptions),
      updated_at: now.slice(0, 10),
    }), PATCH_APPLY_CONTEXT);
    return;
  }

  if (op.op === "delete") {
    if (!op.target_id) throw new Error(`Patch op ${op.op_id} missing target_id`);
    const mode = op.deletion_mode ?? "audit_preserving";
    const reason = op.deletion_reason ?? "other";
    let foundContent = "";
    updateMemoryRecord(root, op.target_id, (record) => {
      foundContent = JSON.stringify({ statement: record.statement, evidence: record.evidence, tags: record.tags });
      const tombstone = createDeletionTombstone({
        resource_id: record.resource_id,
        profile_id: record.profile_id,
        deleted_record_id: record.id,
        deletion_mode: mode,
        deletion_reason: reason,
        content: foundContent,
        now,
      });
      appendDeletionTombstone(root, tombstone);
      if (mode === "privacy_purge") {
        redactEvidenceForMemory(root, record.id);
        return {
          ...record,
          statement: "[deleted]",
          tags: [],
          evidence: [{ type: "deletion", ref: tombstone.id, note: "Content removed by privacy purge." }],
          confidence: 0,
          status: "deleted" as const,
          updated_at: now.slice(0, 10),
        };
      }
      return { ...record, status: "deleted" as const, updated_at: now.slice(0, 10) };
    }, PATCH_APPLY_CONTEXT);
    return;
  }

  if (op.op === "supersede") {
    if (!op.target_id || !op.to_record) throw new Error(`Patch op ${op.op_id} missing supersede fields`);
    const replacement = {
      ...op.to_record,
      supersedes: [...new Set([...(op.to_record.supersedes ?? []), op.target_id])],
      updated_at: now.slice(0, 10),
    };
    updateMemoryRecord(root, op.target_id, (record) => ({
      ...record,
      status: "superseded",
      superseded_by: [...new Set([...record.superseded_by, replacement.id])],
      updated_at: now.slice(0, 10),
    }), PATCH_APPLY_CONTEXT);
    addMemoryRecordFromPatch(root, replacement);
    return;
  }

  if (op.op === "promote_to_vault_candidate") {
    writeVaultPromotionReport(root, patchId, op);
    return;
  }
}

export function writePatchFile(root: string, patch: MemoryPatch): string {
  const paths = ensureMemoryDirs(root);
  const file = join(paths.patches, `${patch.patch_id}.json`);
  writeFileSync(file, `${JSON.stringify(patch, null, 2)}\n`, "utf-8");
  return file;
}

export function listPatchFiles(root: string): string[] {
  const paths = ensureMemoryDirs(root);
  return readdirSync(paths.patches)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

export function readPatchFile(root: string, patchId: string): MemoryPatch {
  const paths = ensureMemoryDirs(root);
  const filename = patchId.endsWith(".json") ? patchId : `${patchId}.json`;
  const file = join(paths.patches, filename);
  if (!existsSync(file)) throw new Error(`Patch not found: ${patchId}`);
  return JSON.parse(readFileSync(file, "utf-8")) as MemoryPatch;
}

export function applyPatch(root: string, patch: MemoryPatch, options: ApplyPatchOptions): MemoryPatch {
  writePatchFile(root, patch);
  const applied_ops: string[] = [];
  const skipped_ops: string[] = [];
  for (const op of patch.ops) {
    if (isSelected(op, options.selectedOpIds) && canApplyOp(root, op)) {
      applyOp(root, patch.patch_id, op, options.now);
      applied_ops.push(op.op_id);
    } else {
      skipped_ops.push(op.op_id);
    }
  }
  const appliedPatch: MemoryPatch = {
    ...patch,
    status: skipped_ops.length ? "partially_applied" : "applied",
    applied_at: options.now,
    applied_ops,
    skipped_ops,
  };
  writePatchFile(root, appliedPatch);
  renderMemoryToDisk(root);
  const appliedOps = patch.ops.filter((op) => applied_ops.includes(op.op_id));
  runPostMutationChecks({
    root,
    patchId: patch.patch_id,
    ops: appliedOps,
    affectedRecordIds: appliedOps.flatMap((op) => [op.target_id, op.record?.id, op.to_record?.id].filter((id): id is string => Boolean(id))),
    mode: appliedOps.some((op) => op.deletion_mode === "privacy_purge") ? "privacy_purge" : appliedOps.some((op) => op.deletion_mode === "audit_preserving") ? "audit_preserving" : "normal",
  });
  // FTS/qmd sync remains a caller invariant: extension flows call updateQmd()/syncFtsIndex()
  // after patch application. Keeping this here avoids coupling patch application to an index backend.
  return appliedPatch;
}
