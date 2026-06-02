import { createHash } from "node:crypto";
import { appendJsonl, readJsonl, writeJsonl } from "./jsonl";
import { ensureMemoryDirs } from "./paths";
import { scanSecrets, shouldBlockPersistence } from "./secret-scanner";
import type { EvidenceRecord, EvidenceSourceKind } from "./types";

export const SOURCE_EXCERPT_MAX_CHARS = 1000;
export const SOURCE_SUMMARY_MAX_CHARS = 300;

export interface EvidenceIdInput {
  profile_id: string;
  thread_id?: string;
  source_session_id?: string;
  source_kind: EvidenceSourceKind;
  source_ref?: string;
  source_excerpt?: string;
  source_summary?: string;
}

function normalizeContent(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createEvidenceId(input: EvidenceIdInput): string {
  const identity = input.thread_id ?? input.source_session_id ?? "no-thread";
  const content = normalizeContent(input.source_excerpt || input.source_summary);
  return sha256([
    input.profile_id,
    identity,
    input.source_kind,
    input.source_ref ?? "",
    content,
  ].join("\n")).slice(0, 32);
}

export function boundSourceExcerpt(excerpt: string | undefined, maxChars = SOURCE_EXCERPT_MAX_CHARS): string | undefined {
  if (excerpt === undefined) return undefined;
  return excerpt.slice(0, maxChars);
}

export function boundSourceSummary(summary: string, maxChars = SOURCE_SUMMARY_MAX_CHARS): string {
  return summary.slice(0, maxChars);
}

export function normalizeEvidenceRecord(record: EvidenceRecord): EvidenceRecord {
  const source_excerpt = boundSourceExcerpt(record.source_excerpt);
  const source_summary = boundSourceSummary(record.source_summary);
  const id = record.id || createEvidenceId({
    profile_id: record.profile_id,
    thread_id: record.thread_id,
    source_session_id: record.source_session_id,
    source_kind: record.source_kind,
    source_ref: record.source_ref ?? record.source_file ?? record.source_tool,
    source_excerpt,
    source_summary,
  });
  return {
    ...record,
    id,
    source_excerpt,
    source_summary,
    excerpt_hash: source_excerpt ? sha256(source_excerpt).slice(0, 32) : record.excerpt_hash,
    redaction_status: record.redaction_status ?? "none",
    related_memory_ids: record.related_memory_ids ?? [],
  };
}

export function appendEvidenceRecord(root: string, record: EvidenceRecord): EvidenceRecord {
  const paths = ensureMemoryDirs(root);
  const secretScan = scanSecrets(JSON.stringify(record));
  if (shouldBlockPersistence(secretScan)) throw new Error("Blocked evidence persistence: high-confidence secret-like content detected.");
  const normalized = normalizeEvidenceRecord(record);
  appendJsonl(paths.memory.evidence, normalized);
  return normalized;
}

export function readEvidenceRecords(root: string): EvidenceRecord[] {
  const paths = ensureMemoryDirs(root);
  return readJsonl<EvidenceRecord>(paths.memory.evidence);
}

export function findEvidenceById(root: string, id: string): EvidenceRecord | null {
  return readEvidenceRecords(root).find((record) => record.id === id) ?? null;
}

export function redactEvidenceForMemory(root: string, memoryId: string): void {
  const paths = ensureMemoryDirs(root);
  const records = readEvidenceRecords(root).map((record) => {
    if (!record.related_memory_ids.includes(memoryId)) return record;
    return {
      ...record,
      source_summary: "[deleted]",
      source_excerpt: undefined,
      excerpt_hash: undefined,
      redaction_status: "deleted" as const,
      notes: "Linked memory was privacy-purged.",
    };
  });
  writeJsonl(paths.memory.evidence, records);
}
