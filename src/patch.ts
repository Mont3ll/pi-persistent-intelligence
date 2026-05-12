import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addMemoryRecord, updateMemoryRecord } from "./store";
import { updateCandidateStatus } from "./inbox";
import { renderMemoryToDisk } from "./render";
import { ensureMemoryDirs } from "./paths";
import { writeVaultPromotionReport } from "./vaultPromotion";
import type { MemoryPatch, PatchOp } from "./types";

export interface ApplyPatchOptions {
  selectedOpIds?: string[];
  now: string;
}

function isSelected(op: PatchOp, selected?: string[]): boolean {
  return selected ? selected.includes(op.op_id) : op.default_selected;
}

function applyOp(root: string, patchId: string, op: PatchOp, now: string): void {
  if (op.op === "add") {
    if (!op.record) throw new Error(`Patch op ${op.op_id} missing record`);
    addMemoryRecord(root, op.record);
    if (op.candidate_id) updateCandidateStatus(root, op.candidate_id, "patched");
    return;
  }

  if (op.op === "decay" || op.op === "update") {
    if (!op.target_id || !op.updates) throw new Error(`Patch op ${op.op_id} missing update fields`);
    updateMemoryRecord(root, op.target_id, (record) => ({ ...record, ...op.updates }));
    return;
  }

  if (op.op === "deprecate") {
    if (!op.target_id) throw new Error(`Patch op ${op.op_id} missing target_id`);
    updateMemoryRecord(root, op.target_id, (record) => ({ ...record, status: "deprecated", updated_at: now.slice(0, 10) }));
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
    }));
    addMemoryRecord(root, replacement);
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
    if (isSelected(op, options.selectedOpIds)) {
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
  return appliedPatch;
}
