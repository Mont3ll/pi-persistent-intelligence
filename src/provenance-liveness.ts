import { existsSync } from "node:fs";
import { readEvidenceRecords } from "./evidence";
import { loadAllRecords } from "./store";
import { isTombstonedRecord } from "./tombstones";
import type { EvidenceRecord, MemoryRecord } from "./types";

export type ProvenanceLivenessStatus = "alive" | "warning" | "invalid" | "unknown";

export interface ProvenanceLivenessFinding {
  code: "source_file_missing" | "evidence_redacted_or_deleted" | "evidence_missing" | "memory_tombstoned" | "project_scope_missing";
  status: ProvenanceLivenessStatus;
  severity: "info" | "warning" | "error";
  memory_id?: string;
  evidence_id?: string;
  message: string;
}

export interface ProvenanceLivenessCheckResult {
  timestamp: string;
  findings: ProvenanceLivenessFinding[];
  reverification_memory_ids: string[];
}

function evidenceById(records: EvidenceRecord[]): Map<string, EvidenceRecord> {
  return new Map(records.map((record) => [record.id, record]));
}

function memoryEvidenceIds(record: MemoryRecord): string[] {
  return [...new Set([
    ...record.evidence.map((ev) => ev.ref),
  ].filter(Boolean))];
}

export function checkProvenanceLiveness(root: string, now = new Date().toISOString()): ProvenanceLivenessCheckResult {
  const memories = loadAllRecords(root);
  const evidence = readEvidenceRecords(root);
  const byEvidenceId = evidenceById(evidence);
  const findings: ProvenanceLivenessFinding[] = [];
  const reverify = new Set<string>();

  for (const memory of memories) {
    if (isTombstonedRecord(root, memory.id)) {
      findings.push({ code: "memory_tombstoned", status: "invalid", severity: "error", memory_id: memory.id, message: `Memory ${memory.id} is tombstoned.` });
      reverify.add(memory.id);
    }

    if (memory.scope.type === "project" && memory.scope.project && memory.scope.project.startsWith("/") && !existsSync(memory.scope.project)) {
      findings.push({ code: "project_scope_missing", status: "warning", severity: "warning", memory_id: memory.id, message: `Project scope no longer resolves: ${memory.scope.project}` });
      reverify.add(memory.id);
    }

    for (const evidenceId of memoryEvidenceIds(memory)) {
      const ev = byEvidenceId.get(evidenceId);
      if (!ev) {
        // Legacy records often reference non-structured evidence. Treat as unknown, not invalid.
        continue;
      }
      if (ev.redaction_status === "redacted" || ev.redaction_status === "deleted") {
        findings.push({ code: "evidence_redacted_or_deleted", status: "invalid", severity: "warning", memory_id: memory.id, evidence_id: ev.id, message: `Supporting evidence ${ev.id} is ${ev.redaction_status}.` });
        reverify.add(memory.id);
      }
      if (ev.source_kind === "file" && ev.source_file && !existsSync(ev.source_file)) {
        findings.push({ code: "source_file_missing", status: "warning", severity: "warning", memory_id: memory.id, evidence_id: ev.id, message: `Evidence source file no longer exists: ${ev.source_file}` });
        reverify.add(memory.id);
      }
    }
  }

  return { timestamp: now, findings, reverification_memory_ids: [...reverify].sort() };
}
