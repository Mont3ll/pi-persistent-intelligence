import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { boundSourceSummary, createEvidenceId } from "./evidence";
import { readJsonl, writeJsonlAtomic } from "./jsonl";
import { resolvePaths } from "./paths";
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

export interface LegacyEvidenceMigrationApplyResult {
  dry_run: false;
  mutation_performed: boolean;
  fingerprint: string;
  evidence_created: number;
  records_updated: number;
  backup_path?: string;
  report_path?: string;
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

interface CanonicalRow {
  file: string;
  record: MemoryRecord;
}

function canonicalRows(root: string): CanonicalRow[] {
  const paths = resolvePaths(root);
  const files = [paths.memory.L1, paths.memory.L2];
  if (existsSync(paths.memory.projects)) {
    files.push(...readdirSync(paths.memory.projects)
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .map((name) => join(paths.memory.projects, name)));
  }
  return files.filter(existsSync).flatMap((file) => readJsonl<MemoryRecord>(file).map((record) => ({ file, record })));
}

export function scanLegacyEvidenceMigration(root: string): LegacyEvidenceMigrationPlan {
  const paths = resolvePaths(root);
  const records = canonicalRows(root).map((row) => row.record);
  const evidence = existsSync(paths.memory.evidence) ? readJsonl<EvidenceRecord>(paths.memory.evidence) : [];
  return planLegacyEvidenceMigration(root, records, evidence);
}

function timestampSlug(now: string): string {
  return now.replace(/[^0-9]/g, "").slice(0, 17);
}

export function applyLegacyEvidenceMigration(
  root: string,
  expectedFingerprint: string,
  now = new Date().toISOString(),
): LegacyEvidenceMigrationApplyResult {
  const plan = scanLegacyEvidenceMigration(root);
  if (plan.fingerprint !== expectedFingerprint) throw new Error("Legacy evidence migration preview is stale; run preview again.");
  const base = {
    dry_run: false as const,
    mutation_performed: false,
    fingerprint: plan.fingerprint,
    evidence_created: 0,
    records_updated: 0,
  };
  if (plan.proposals.length === 0) return base;

  const paths = resolvePaths(root);
  const rows = canonicalRows(root);
  const evidenceByReference = new Map<string, string>();
  for (const proposal of plan.proposals) {
    for (const reference of proposal.record_references) {
      evidenceByReference.set(`${reference.memory_id}\n${reference.original_ref}`, proposal.evidence.id);
    }
  }
  const updatedRows = rows.map((row) => {
    const additions = row.record.evidence.flatMap((inline) => {
      const id = evidenceByReference.get(`${row.record.id}\n${inline.ref}`);
      if (!id || row.record.evidence.some((item) => item.ref === id)) return [];
      return [{ type: "source" as const, ref: id, note: "Structured evidence created by legacy_evidence_backfill_v1." }];
    });
    return additions.length > 0
      ? { ...row, record: { ...row.record, evidence: [...row.record.evidence, ...additions] } }
      : row;
  });
  const affectedFiles = [...new Set(updatedRows
    .filter((row, index) => row.record !== rows[index].record)
    .map((row) => row.file))].sort();
  const slug = timestampSlug(now);
  const backupPath = join(root, "backups", `legacy-evidence-backfill-v1-${slug}`);
  const backupFiles = [paths.memory.evidence, ...affectedFiles].filter(existsSync);
  for (const file of backupFiles) {
    const destination = join(backupPath, relative(root, file));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(file, destination);
  }

  const existingEvidence = existsSync(paths.memory.evidence) ? readJsonl<EvidenceRecord>(paths.memory.evidence) : [];
  writeJsonlAtomic(paths.memory.evidence, [...existingEvidence, ...plan.proposals.map((proposal) => proposal.evidence)]);
  for (const file of affectedFiles) {
    writeJsonlAtomic(file, updatedRows.filter((row) => row.file === file).map((row) => row.record));
  }
  const reportPath = join(root, "reports", `legacy-evidence-backfill-${slug}.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  const result: LegacyEvidenceMigrationApplyResult = {
    ...base,
    mutation_performed: true,
    evidence_created: plan.proposals.length,
    records_updated: new Set(plan.proposals.flatMap((proposal) => proposal.evidence.related_memory_ids)).size,
    backup_path: backupPath,
    report_path: reportPath,
  };
  writeFileSync(reportPath, `${JSON.stringify({ ...result, plan }, null, 2)}\n`, "utf-8");
  return result;
}
