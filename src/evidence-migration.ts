import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { boundSourceSummary, createEvidenceId } from "./evidence";
import { scanSecrets, shouldBlockPersistence } from "./secret-scanner";
import type { EvidenceRecord, EvidenceSourceKind, MemoryRecord } from "./types";

export interface LegacyEvidenceProposal {
  evidence: EvidenceRecord;
  record_references: Array<{ memory_id: string; original_ref: string }>;
  source_sha256: string;
}

export interface LegacyEvidenceFinding {
  memory_id: string;
  reference: string;
  reason: "missing" | "outside_store" | "secret_blocked";
}

export interface LegacyEvidenceMigrationPlan {
  dry_run: true;
  mutation_performed: false;
  fingerprint: string;
  records_scanned: number;
  references_scanned: number;
  evidence_to_create: number;
  existing_evidence_skipped: number;
  unresolved_references: number;
  blocked_secret_references: number;
  proposals: LegacyEvidenceProposal[];
  findings: LegacyEvidenceFinding[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceKind(reference: string): EvidenceSourceKind {
  return reference.replaceAll("\\", "/").startsWith("daily/") ? "conversation" : "file";
}

function resolveReference(root: string, reference: string): { path?: string; reason?: "missing" | "outside_store" } {
  const rootPath = realpathSync(root);
  const candidate = isAbsolute(reference) ? resolve(reference) : resolve(root, reference);
  const rel = relative(rootPath, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) return { reason: "outside_store" };
  if (!existsSync(candidate)) return { reason: "missing" };
  return { path: candidate };
}

export function planLegacyEvidenceMigration(
  root: string,
  records: MemoryRecord[],
  existingEvidence: EvidenceRecord[],
): LegacyEvidenceMigrationPlan {
  const existingIds = new Set(existingEvidence.map((evidence) => evidence.id));
  const proposals = new Map<string, LegacyEvidenceProposal>();
  const findings: LegacyEvidenceFinding[] = [];
  let referencesScanned = 0;
  let existingEvidenceSkipped = 0;
  let blockedSecretReferences = 0;

  for (const record of records) {
    if (record.status === "deleted") continue;
    for (const inline of record.evidence) {
      referencesScanned++;
      if (existingIds.has(inline.ref)) {
        existingEvidenceSkipped++;
        continue;
      }
      const resolved = resolveReference(root, inline.ref);
      if (!resolved.path) {
        findings.push({ memory_id: record.id, reference: inline.ref, reason: resolved.reason! });
        continue;
      }
      const sourceText = readFileSync(resolved.path, "utf-8");
      if (shouldBlockPersistence(scanSecrets(sourceText))) {
        blockedSecretReferences++;
        findings.push({ memory_id: record.id, reference: inline.ref, reason: "secret_blocked" });
        continue;
      }
      const source_kind = sourceKind(inline.ref);
      const source_summary = boundSourceSummary(sourceText.trim().replace(/\s+/g, " ") || `Legacy source ${inline.ref}`);
      const profile_id = record.profile_id ?? "legacy-default";
      const evidenceId = createEvidenceId({
        profile_id,
        source_kind,
        source_ref: inline.ref,
        source_summary,
      });
      if (existingIds.has(evidenceId)) {
        existingEvidenceSkipped++;
        continue;
      }
      const current = proposals.get(evidenceId);
      if (current) {
        if (!current.evidence.related_memory_ids.includes(record.id)) current.evidence.related_memory_ids.push(record.id);
        current.record_references.push({ memory_id: record.id, original_ref: inline.ref });
        continue;
      }
      proposals.set(evidenceId, {
        evidence: {
          id: evidenceId,
          resource_id: record.resource_id ?? "legacy-migration",
          profile_id,
          created_at: record.created_at,
          source_kind,
          source_file: inline.ref,
          source_ref: inline.ref,
          source_summary,
          trust_class: "unknown",
          polarity: "supports",
          durability_signal: "unknown",
          related_memory_ids: [record.id],
          scope_level: record.scope.type,
          scope_ref: record.scope.type === "project" ? record.scope.project : record.scope.type === "domain" ? record.scope.domains?.join(",") : undefined,
          tags: ["legacy-evidence-backfill"],
          notes: "legacy_evidence_backfill_v1",
        },
        record_references: [{ memory_id: record.id, original_ref: inline.ref }],
        source_sha256: sha256(sourceText),
      });
    }
  }

  const ordered = [...proposals.values()].sort((a, b) => a.evidence.id.localeCompare(b.evidence.id));
  const fingerprint = sha256(JSON.stringify({
    records: records.map((record) => ({ id: record.id, status: record.status, evidence: record.evidence })),
    existing_ids: [...existingIds].sort(),
    proposals: ordered,
    findings,
  }));
  return {
    dry_run: true,
    mutation_performed: false,
    fingerprint,
    records_scanned: records.length,
    references_scanned: referencesScanned,
    evidence_to_create: ordered.length,
    existing_evidence_skipped: existingEvidenceSkipped,
    unresolved_references: findings.filter((finding) => finding.reason !== "secret_blocked").length,
    blocked_secret_references: blockedSecretReferences,
    proposals: ordered,
    findings,
  };
}
