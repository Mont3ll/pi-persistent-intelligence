import { createHash } from "node:crypto";
import { appendJsonl, readJsonl } from "./jsonl";
import { ensureMemoryDirs } from "./paths";
import type { DeletionMode, DeletionReason, DeletionTombstone } from "./types";

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

export interface CreateDeletionTombstoneInput {
  resource_id?: string;
  profile_id?: string;
  deleted_record_id: string;
  deletion_mode: DeletionMode;
  deletion_reason: DeletionReason;
  content?: string;
  now?: string;
}

export function createDeletionTombstone(input: CreateDeletionTombstoneInput): DeletionTombstone {
  const deletedAt = input.now ?? new Date().toISOString();
  return {
    id: `tomb_${input.deleted_record_id}_${hash(`${input.deleted_record_id}\n${deletedAt}`).slice(0, 10)}`,
    resource_id: input.resource_id,
    profile_id: input.profile_id,
    deleted_record_id: input.deleted_record_id,
    deleted_at: deletedAt,
    deletion_mode: input.deletion_mode,
    deletion_reason: input.deletion_reason,
    content_hash: input.content ? hash(input.content) : undefined,
    content_removed: true,
  };
}

export function appendDeletionTombstone(root: string, tombstone: DeletionTombstone): DeletionTombstone {
  const paths = ensureMemoryDirs(root);
  if (!isTombstonedRecord(root, tombstone.deleted_record_id)) appendJsonl(paths.memory.tombstones, tombstone);
  return tombstone;
}

export function readDeletionTombstones(root: string): DeletionTombstone[] {
  const paths = ensureMemoryDirs(root);
  return readJsonl<DeletionTombstone>(paths.memory.tombstones);
}

export function isTombstonedRecord(root: string, recordId: string): boolean {
  return readDeletionTombstones(root).some((tombstone) => tombstone.deleted_record_id === recordId);
}
