import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readEvidenceRecords } from "./evidence";
import { ensureMemoryDirs } from "./paths";
import { appendRuntimeEvent } from "./runtime-events";
import { loadActiveRecords, loadAllRecords } from "./store";
import { isTombstonedRecord, readDeletionTombstones } from "./tombstones";
import { isMemoryRecord, type DeletionMode, type PatchOp } from "./types";

export interface PostMutationCheckInput {
  root: string;
  patchId?: string;
  ops: PatchOp[];
  affectedRecordIds: string[];
  mode?: DeletionMode | "normal";
  ftsIndex?: unknown;
}

export interface PostMutationFinding {
  severity: "info" | "warning" | "error";
  code:
    | "affected_record_missing"
    | "deleted_record_still_active"
    | "privacy_purge_statement_not_redacted"
    | "privacy_purge_evidence_not_redacted"
    | "tombstone_missing"
    | "fts_missing_active_record"
    | "rendered_projection_leak"
    | "post_mutation_check_failed";
  message: string;
  record_id?: string;
  evidence_id?: string;
}

function opRecordId(op: PatchOp): string | undefined {
  return op.record?.id ?? op.to_record?.id ?? op.target_id;
}

function expectsRecordAfter(op: PatchOp): boolean {
  return ["add", "update", "update_stability", "flag_for_review", "decay", "deprecate", "contest", "uncontest", "add_exception", "supersede"].includes(op.op);
}

function destructiveMode(op: PatchOp, inputMode?: PostMutationCheckInput["mode"]): DeletionMode | undefined {
  if (op.op === "delete") return op.deletion_mode ?? (inputMode === "privacy_purge" || inputMode === "audit_preserving" ? inputMode : "audit_preserving");
  if (op.op === "supersede" || op.op === "deprecate") return "audit_preserving";
  return undefined;
}

function renderedFiles(root: string): string[] {
  const paths = ensureMemoryDirs(root);
  const out: string[] = [];
  const memory = paths.rendered.memory;
  if (existsSync(memory)) out.push(memory);
  const projects = paths.rendered.projects;
  if (existsSync(projects)) {
    for (const name of readdirSync(projects)) if (name.endsWith(".md")) out.push(join(projects, name));
  }
  return out;
}

function maybeSearch(index: unknown, query: string): Array<{ id?: string; statement?: string }> {
  if (!index || typeof (index as { search?: unknown }).search !== "function") return [];
  return ((index as { search: (query: string, limit?: number) => Array<{ id?: string; statement?: string }> }).search(query, 10)) ?? [];
}

function addRuntimeEvent(root: string, patchId: string | undefined, finding: PostMutationFinding): void {
  if (finding.severity === "info") return;
  appendRuntimeEvent(root, {
    type: finding.severity === "error" ? "error" : "warn",
    severity: finding.severity === "error" ? "high" : "medium",
    component: "post-mutation",
    message: `${finding.code} after patch ${patchId ?? "unknown"}${finding.record_id ? ` for ${finding.record_id}` : ""}`,
  });
}

export function runPostMutationChecks(input: PostMutationCheckInput): PostMutationFinding[] {
  const findings: PostMutationFinding[] = [];
  const add = (finding: PostMutationFinding) => {
    findings.push(finding);
    addRuntimeEvent(input.root, input.patchId, finding);
  };

  try {
    if (input.ftsIndex) maybeSearch(input.ftsIndex, "__post_mutation_probe__");
    const allRecords = loadAllRecords(input.root);
    const activeRecords = loadActiveRecords(input.root);
    const byId = new Map(allRecords.map((record) => [record.id, record]));
    const activeIds = new Set(activeRecords.map((record) => record.id));
    const tombstones = readDeletionTombstones(input.root);
    const tombstonedIds = new Set(tombstones.map((t) => t.deleted_record_id));
    const evidence = readEvidenceRecords(input.root);
    const opIds = new Set(input.ops.map(opRecordId).filter((id): id is string => Boolean(id)));
    const affectedIds = [...new Set([...input.affectedRecordIds, ...opIds])];

    for (const op of input.ops) {
      const id = opRecordId(op);
      if (!id) continue;
      if (expectsRecordAfter(op) && !byId.has(id) && op.op !== "supersede") {
        add({ severity: "error", code: "affected_record_missing", message: "Affected record is missing after mutation.", record_id: id });
      }
      if (op.op === "supersede" && op.to_record && !byId.has(op.to_record.id)) {
        add({ severity: "error", code: "affected_record_missing", message: "Replacement record is missing after supersede mutation.", record_id: op.to_record.id });
      }
    }

    for (const id of affectedIds) {
      const record = byId.get(id);
      const relatedOps = input.ops.filter((op) => opRecordId(op) === id || op.to_record?.id === id);
      const isDestructive = relatedOps.some((op) => destructiveMode(op, input.mode));
      if (!record && relatedOps.some(expectsRecordAfter)) {
        add({ severity: "error", code: "affected_record_missing", message: "Affected record is missing after mutation.", record_id: id });
        continue;
      }
      if (isDestructive && activeIds.has(id)) {
        add({ severity: "error", code: "deleted_record_still_active", message: "Deleted, superseded, deprecated, or purged record is still active.", record_id: id });
      }
      if (relatedOps.some((op) => op.op === "delete") && !tombstonedIds.has(id) && !isTombstonedRecord(input.root, id)) {
        add({ severity: "error", code: "tombstone_missing", message: "Delete/privacy-purge operation did not leave a tombstone.", record_id: id });
      }
      if (relatedOps.some((op) => destructiveMode(op, input.mode) === "privacy_purge")) {
        if (record && (record.status !== "deleted" || record.statement !== "[deleted]" || !isMemoryRecord(record))) {
          add({ severity: "error", code: "privacy_purge_statement_not_redacted", message: "Privacy-purged record is not redacted according to store semantics.", record_id: id });
        }
        for (const ev of evidence.filter((ev) => ev.related_memory_ids.includes(id))) {
          if (ev.redaction_status !== "deleted" && ev.redaction_status !== "redacted") {
            add({ severity: "error", code: "privacy_purge_evidence_not_redacted", message: "Linked evidence remains unredacted after privacy purge.", record_id: id, evidence_id: ev.id });
          }
        }
        const originalTerms = relatedOps.flatMap((op) => [op.record?.statement, op.to_record?.statement]).filter(Boolean) as string[];
        for (const file of renderedFiles(input.root)) {
          const rendered = readFileSync(file, "utf-8");
          for (const term of originalTerms) {
            if (term && term !== "[deleted]" && rendered.includes(term)) {
              add({ severity: "error", code: "rendered_projection_leak", message: "Rendered projection contains privacy-purged content.", record_id: id });
            }
          }
        }
      }
    }

    if (input.ftsIndex) {
      for (const record of activeRecords.filter((record) => affectedIds.includes(record.id))) {
        const results = maybeSearch(input.ftsIndex, record.id);
        if (results.length > 0 && !results.some((row) => row.id === record.id)) {
          add({ severity: "warning", code: "fts_missing_active_record", message: "FTS lookup did not return active affected record by id.", record_id: record.id });
        }
      }
      for (const op of input.ops.filter((op) => destructiveMode(op, input.mode) === "privacy_purge" || op.op === "delete")) {
        const id = op.target_id;
        const statement = op.record?.statement ?? op.to_record?.statement;
        if (id && statement && maybeSearch(input.ftsIndex, statement).some((row) => row.id === id || row.statement === statement)) {
          add({ severity: "warning", code: "deleted_record_still_active", message: "FTS search still returns deleted/privacy-purged content.", record_id: id });
        }
      }
    }
  } catch (error) {
    add({ severity: "error", code: "post_mutation_check_failed", message: `Post-mutation checker failed: ${error instanceof Error ? error.message : String(error)}` });
  }

  return findings;
}
