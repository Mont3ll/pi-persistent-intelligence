import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readEvidenceRecords } from "./evidence";
import { readInquiryRecords } from "./inquiries";
import { ensureMemoryDirs } from "./paths";
import { readReinforcementEvents } from "./reinforcement";
import { loadAllRecords } from "./store";
import { readDeletionTombstones } from "./tombstones";
import { listCandidates } from "./inbox";
import { redactSecretsInObject } from "./secret-scanner";
import type { DeletionTombstone, MemoryRecord } from "./types";

export interface EffectiveMemoryValidity {
  valid_from: string;
  valid_to?: string;
  invalidated_by?: string;
  validity_reason: string;
}

export interface TimelineEvent {
  timestamp: string;
  type: "memory_created" | "memory_updated" | "evidence_created" | "candidate_created" | "reinforcement_event" | "inquiry_created" | "inquiry_answered" | "supersession" | "tombstone";
  id: string;
  memory_id?: string;
  summary: string;
  payload?: Record<string, unknown>;
}

export interface MemoryTimelineReport {
  generated_at: string;
  memory_id?: string;
  events: TimelineEvent[];
}

export function getMemoryValidity(record: MemoryRecord, relatedTombstones: DeletionTombstone[], supersessionRecords: MemoryRecord[]): EffectiveMemoryValidity {
  if (record.valid_to) {
    return { valid_from: record.valid_from ?? record.created_at, valid_to: record.valid_to, invalidated_by: record.invalidated_by, validity_reason: record.validity_reason ?? "Explicit validity fields." };
  }
  const tombstone = relatedTombstones.find((t) => t.deleted_record_id === record.id);
  if (tombstone) return { valid_from: record.valid_from ?? record.created_at, valid_to: tombstone.deleted_at, invalidated_by: tombstone.id, validity_reason: "Invalidated by deletion tombstone." };
  if (record.status === "superseded") {
    const replacement = supersessionRecords.find((candidate) => candidate.supersedes?.includes(record.id) || record.superseded_by?.includes(candidate.id));
    if (replacement) return { valid_from: record.valid_from ?? record.created_at, valid_to: replacement.created_at, invalidated_by: replacement.id, validity_reason: "Invalidated by supersession." };
  }
  return { valid_from: record.valid_from ?? record.created_at, validity_reason: "Valid from record creation." };
}

export function buildMemoryTimeline(root: string, options: { memoryId?: string } = {}, now = new Date().toISOString()): MemoryTimelineReport {
  const events: TimelineEvent[] = [];
  const memories = loadAllRecords(root);
  const include = (memoryId: string | undefined) => !options.memoryId || memoryId === options.memoryId;

  for (const memory of memories) {
    if (!include(memory.id)) continue;
    events.push({ timestamp: memory.created_at, type: "memory_created", id: memory.id, memory_id: memory.id, summary: `Memory created: ${memory.statement.slice(0, 80)}` });
    if (memory.updated_at !== memory.created_at) events.push({ timestamp: memory.updated_at, type: "memory_updated", id: memory.id, memory_id: memory.id, summary: `Memory updated: ${memory.id}` });
    for (const superseded of memory.supersedes ?? []) events.push({ timestamp: memory.created_at, type: "supersession", id: `${memory.id}->${superseded}`, memory_id: memory.id, summary: `${memory.id} supersedes ${superseded}` });
  }

  for (const ev of readEvidenceRecords(root)) {
    const related = ev.related_memory_ids ?? [];
    if (options.memoryId && !related.includes(options.memoryId)) continue;
    events.push({ timestamp: ev.created_at, type: "evidence_created", id: ev.id, memory_id: related[0], summary: `Evidence created: ${ev.source_summary.slice(0, 80)}` });
  }

  for (const candidate of listCandidates(root)) {
    if (options.memoryId && !(candidate.matched_memory_ids ?? []).includes(options.memoryId)) continue;
    events.push({ timestamp: candidate.created_at, type: "candidate_created", id: candidate.id, memory_id: candidate.matched_memory_ids?.[0], summary: `Candidate created: ${candidate.text.slice(0, 80)}` });
  }

  for (const event of readReinforcementEvents(root)) {
    if (!include(event.memory_id)) continue;
    events.push({ timestamp: event.timestamp, type: "reinforcement_event", id: event.id, memory_id: event.memory_id, summary: `Reinforcement: ${event.outcome}` });
  }

  for (const inquiry of readInquiryRecords(root)) {
    const related = inquiry.related_memory_ids ?? [];
    if (options.memoryId && !related.includes(options.memoryId) && inquiry.answer_memory_id !== options.memoryId) continue;
    events.push({ timestamp: inquiry.first_seen, type: "inquiry_created", id: inquiry.id, memory_id: related[0], summary: `Inquiry created: ${inquiry.question.slice(0, 80)}` });
    if (inquiry.status === "answered" && inquiry.answer_memory_id) events.push({ timestamp: inquiry.last_seen, type: "inquiry_answered", id: inquiry.id, memory_id: inquiry.answer_memory_id, summary: `Inquiry answered by ${inquiry.answer_memory_id}` });
  }

  for (const tombstone of readDeletionTombstones(root)) {
    if (!include(tombstone.deleted_record_id)) continue;
    events.push({ timestamp: tombstone.deleted_at, type: "tombstone", id: tombstone.id, memory_id: tombstone.deleted_record_id, summary: `Tombstone: ${tombstone.deletion_reason}` });
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  return redactSecretsInObject({ generated_at: now, memory_id: options.memoryId, events }) as MemoryTimelineReport;
}

export function renderMemoryTimeline(report: MemoryTimelineReport): string {
  return [`PI Memory Timeline - ${report.generated_at}`, report.memory_id ? `Memory: ${report.memory_id}` : "Memory: all", "", ...report.events.map((event) => `- ${event.timestamp} [${event.type}] ${event.summary}`)].join("\n");
}

export function saveMemoryTimelineReport(root: string, report: MemoryTimelineReport): string {
  const dir = join(ensureMemoryDirs(root).reports, "timeline");
  mkdirSync(dir, { recursive: true });
  const stamp = report.generated_at.replace(/[:.]/g, "-").slice(0, 19);
  const path = join(dir, `${stamp}.json`);
  writeFileSync(path, `${JSON.stringify(redactSecretsInObject(report), null, 2)}\n`, "utf-8");
  return path;
}
