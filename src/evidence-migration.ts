import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { resolveEvidenceReference, type EvidenceResolutionReason } from "./evidence-resolution";
import { readJsonl } from "./jsonl";
import { resolvePaths } from "./paths";
import type { EvidenceRecord, MemoryRecord } from "./types";

export interface LegacyEvidenceProposal {
  evidence: EvidenceRecord;
  record_references: Array<{ memory_id: string; original_ref: string }>;
  source_sha256: string;
}

export interface LegacyEvidenceFinding {
  memory_id: string;
  reference: string;
  reason: EvidenceResolutionReason;
}

export interface LegacyEvidenceMigrationApplyResult {
  dry_run: false;
  mutation_performed: boolean;
  fingerprint: string;
  evidence_created: number;
  records_updated: number;
  post_apply_evidence_to_create: number;
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
  unresolved_reason_counts: Partial<Record<EvidenceResolutionReason, number>>;
  record_hashes: Array<{ id: string; sha256: string }>;
  links_to_add: Array<{ memory_id: string; original_ref: string; evidence_id: string }>;
  proposals: LegacyEvidenceProposal[];
  findings: LegacyEvidenceFinding[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function planLegacyEvidenceMigration(
  root: string,
  records: MemoryRecord[],
  existingEvidence: EvidenceRecord[],
): LegacyEvidenceMigrationPlan {
  const existingIds = new Set(existingEvidence.map((evidence) => evidence.id));
  const proposals = new Map<string, LegacyEvidenceProposal>();
  const linksToAdd: Array<{ memory_id: string; original_ref: string; evidence_id: string }> = [];
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
      const resolution = resolveEvidenceReference({
        root,
        reference: inline.ref,
        existingEvidence,
        memoryId: record.id,
        resourceId: record.resource_id ?? "legacy-migration",
        profileId: record.profile_id ?? "legacy-default",
        createdAt: record.created_at,
        scopeLevel: record.scope.type,
        scopeRef: record.scope.type === "project" ? record.scope.project : record.scope.type === "domain" ? record.scope.domains?.join(",") : undefined,
        provenance: "legacy_evidence_backfill_v2",
      });
      if (resolution.status === "alreadyStructured") {
        existingEvidenceSkipped++;
        if (inline.ref !== resolution.evidenceId && !record.evidence.some((item) => item.ref === resolution.evidenceId)) {
          linksToAdd.push({ memory_id: record.id, original_ref: inline.ref, evidence_id: resolution.evidenceId });
        }
        continue;
      }
      if (resolution.status === "unresolved") {
        if (resolution.reason === "secretDetected") blockedSecretReferences++;
        findings.push({ memory_id: record.id, reference: inline.ref, reason: resolution.reason });
        continue;
      }
      const evidenceId = resolution.evidence.id;
      if (!record.evidence.some((item) => item.ref === evidenceId)) linksToAdd.push({ memory_id: record.id, original_ref: inline.ref, evidence_id: evidenceId });
      const current = proposals.get(evidenceId);
      if (current) {
        if (!current.evidence.related_memory_ids.includes(record.id)) current.evidence.related_memory_ids.push(record.id);
        current.record_references.push({ memory_id: record.id, original_ref: inline.ref });
        continue;
      }
      proposals.set(evidenceId, {
        evidence: resolution.evidence,
        record_references: [{ memory_id: record.id, original_ref: inline.ref }],
        source_sha256: resolution.sourceSha256,
      });
    }
  }

  const ordered = [...proposals.values()].sort((a, b) => a.evidence.id.localeCompare(b.evidence.id));
  const recordHashes = records.map((record) => ({ id: record.id, sha256: sha256(JSON.stringify(record)) })).sort((a, b) => a.id.localeCompare(b.id));
  const fingerprint = sha256(JSON.stringify({
    records: recordHashes,
    existing_ids: [...existingIds].sort(),
    proposals: ordered,
    links: linksToAdd,
    findings,
  }));
  const unresolvedReasonCounts = findings.reduce<Partial<Record<EvidenceResolutionReason, number>>>((counts, finding) => {
    counts[finding.reason] = (counts[finding.reason] ?? 0) + 1;
    return counts;
  }, {});
  return {
    dry_run: true,
    mutation_performed: false,
    fingerprint,
    records_scanned: records.length,
    references_scanned: referencesScanned,
    evidence_to_create: ordered.length,
    existing_evidence_skipped: existingEvidenceSkipped,
    unresolved_references: findings.filter((finding) => finding.reason !== "secretDetected").length,
    blocked_secret_references: blockedSecretReferences,
    unresolved_reason_counts: unresolvedReasonCounts,
    record_hashes: recordHashes,
    links_to_add: linksToAdd,
    proposals: ordered,
    findings,
  };
}

interface CanonicalRow {
  file: string;
  record: MemoryRecord;
}

export interface MigrationFileChange {
  file: string;
  expected: Buffer | null;
  next: Buffer;
}

function writeBufferAtomic(file: string, content: Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
}

function assertMigrationTargetUnchanged(change: MigrationFileChange): void {
  const current = existsSync(change.file) ? readFileSync(change.file) : null;
  if ((current === null) !== (change.expected === null) || (current && change.expected && !current.equals(change.expected))) {
    throw new Error(`Migration target changed after preview: ${change.file}`);
  }
}

export function commitMigrationFileSet(
  changes: MigrationFileChange[],
  beforeRename?: (file: string, index: number) => void,
): void {
  for (const change of changes) assertMigrationTargetUnchanged(change);
  const staged = changes.map((change, index) => {
    const file = `${change.file}.migration-${process.pid}-${Date.now()}-${index}`;
    mkdirSync(dirname(file), { recursive: true });
    const fd = openSync(file, "wx", 0o600);
    try { writeSync(fd, change.next); fsyncSync(fd); } finally { closeSync(fd); }
    return file;
  });
  let committed = 0;
  try {
    for (let index = 0; index < changes.length; index++) {
      beforeRename?.(changes[index].file, index);
      assertMigrationTargetUnchanged(changes[index]);
      renameSync(staged[index], changes[index].file);
      committed++;
    }
  } catch (error) {
    for (let index = committed - 1; index >= 0; index--) {
      const original = changes[index].expected;
      if (original === null) {
        if (existsSync(changes[index].file)) unlinkSync(changes[index].file);
      } else {
        writeBufferAtomic(changes[index].file, original);
      }
    }
    throw error;
  } finally {
    for (const file of staged) if (existsSync(file)) unlinkSync(file);
  }
}

function jsonlBuffer<T>(records: T[]): Buffer {
  const content = records.map((record) => JSON.stringify(record)).join("\n");
  return Buffer.from(content ? `${content}\n` : "", "utf-8");
}

function canonicalFilePaths(root: string): string[] {
  const paths = resolvePaths(root);
  const files = [paths.memory.L1, paths.memory.L2];
  if (existsSync(paths.memory.projects)) {
    files.push(...readdirSync(paths.memory.projects)
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .map((name) => join(paths.memory.projects, name)));
  }
  return files.filter(existsSync);
}

function parseJsonlBuffer<T>(content: Buffer): T[] {
  return content.toString("utf-8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as T);
}

function canonicalRows(root: string): CanonicalRow[] {
  return canonicalFilePaths(root).flatMap((file) => readJsonl<MemoryRecord>(file).map((record) => ({ file, record })));
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

interface PreparedMigrationTransaction {
  state: "prepared" | "committed" | "rolled_back";
  targets: Array<{ file: string; backup: string | null; existed: boolean }>;
  plan_fingerprint?: string;
  recovered_at?: string;
}

export function recoverInterruptedLegacyEvidenceMigration(root: string): number {
  const backups = join(root, "backups");
  if (!existsSync(backups)) return 0;
  let recovered = 0;
  for (const name of readdirSync(backups).filter((item) => item.startsWith("legacy-evidence-backfill-v1-")).sort()) {
    const directory = join(backups, name);
    const transactionPath = join(directory, "transaction.json");
    if (!existsSync(transactionPath)) continue;
    const transaction = JSON.parse(readFileSync(transactionPath, "utf-8")) as PreparedMigrationTransaction;
    if (transaction.state !== "prepared" || !Array.isArray(transaction.targets)) continue;
    for (const target of transaction.targets) {
      const file = resolve(root, target.file);
      if (relative(resolve(root), file).startsWith("..")) throw new Error(`Unsafe migration recovery target: ${target.file}`);
      if (target.existed) {
        if (!target.backup) throw new Error(`Missing migration recovery backup for ${target.file}`);
        const backup = resolve(directory, target.backup);
        if (relative(directory, backup).startsWith("..") || !existsSync(backup)) throw new Error(`Missing migration recovery backup for ${target.file}`);
        writeBufferAtomic(file, readFileSync(backup));
      } else if (existsSync(file)) {
        unlinkSync(file);
      }
    }
    writeFileSync(transactionPath, `${JSON.stringify({ ...transaction, state: "rolled_back", recovered_at: new Date().toISOString() }, null, 2)}\n`, "utf-8");
    recovered++;
  }
  return recovered;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function applyLegacyEvidenceMigration(
  root: string,
  expectedFingerprint: string,
  now = new Date().toISOString(),
): LegacyEvidenceMigrationApplyResult {
  mkdirSync(root, { recursive: true });
  const lockPath = join(root, ".legacy-evidence-migration.lock");
  if (existsSync(lockPath)) {
    let owner = 0;
    try { owner = Number(JSON.parse(readFileSync(lockPath, "utf-8")).pid ?? 0); } catch { /* stale malformed lock */ }
    if (processIsAlive(owner)) throw new Error(`Legacy evidence migration is already running (pid ${owner}).`);
    recoverInterruptedLegacyEvidenceMigration(root);
    unlinkSync(lockPath);
  } else {
    recoverInterruptedLegacyEvidenceMigration(root);
  }
  const lock = openSync(lockPath, "wx", 0o600);
  writeSync(lock, JSON.stringify({ pid: process.pid, started_at: now }));
  fsyncSync(lock);
  try {
    const paths = resolvePaths(root);
    const memorySnapshots = new Map(canonicalFilePaths(root).map((file) => [file, readFileSync(file)]));
    const rows = [...memorySnapshots].flatMap(([file, content]) => parseJsonlBuffer<MemoryRecord>(content).map((record) => ({ file, record })));
    const evidenceSnapshot = existsSync(paths.memory.evidence) ? readFileSync(paths.memory.evidence) : null;
    const existingEvidence = evidenceSnapshot ? parseJsonlBuffer<EvidenceRecord>(evidenceSnapshot) : [];
    const plan = planLegacyEvidenceMigration(root, rows.map((row) => row.record), existingEvidence);
    if (plan.fingerprint !== expectedFingerprint) throw new Error("Legacy evidence migration preview is stale; run preview again.");
    const base = {
      dry_run: false as const,
      mutation_performed: false,
      fingerprint: plan.fingerprint,
      evidence_created: 0,
      records_updated: 0,
      post_apply_evidence_to_create: 0,
    };
    if (plan.proposals.length === 0 && plan.links_to_add.length === 0) return base;
  const evidenceByReference = new Map(plan.links_to_add.map((link) => [`${link.memory_id}\n${link.original_ref}`, link.evidence_id]));
  const updatedRows = rows.map((row) => {
    const additions = row.record.evidence.flatMap((inline) => {
      const id = evidenceByReference.get(`${row.record.id}\n${inline.ref}`);
      if (!id || row.record.evidence.some((item) => item.ref === id)) return [];
      return [{ type: "source" as const, ref: id, note: "Structured evidence created by legacy_evidence_backfill_v2." }];
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
  const backupSnapshots = new Map<string, Buffer>();
  if (evidenceSnapshot && plan.proposals.length > 0) backupSnapshots.set(paths.memory.evidence, evidenceSnapshot);
  for (const file of affectedFiles) backupSnapshots.set(file, memorySnapshots.get(file)!);
  for (const [file, snapshot] of backupSnapshots) {
    const destination = join(backupPath, relative(root, file));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, snapshot);
  }

    const result: LegacyEvidenceMigrationApplyResult = {
      ...base,
      mutation_performed: true,
      evidence_created: plan.proposals.length,
      records_updated: new Set(plan.links_to_add.map((link) => link.memory_id)).size,
      backup_path: backupPath,
      report_path: join(root, "reports", `legacy-evidence-backfill-${slug}.json`),
    };
    mkdirSync(dirname(result.report_path!), { recursive: true });
    const changes: MigrationFileChange[] = [
      ...(plan.proposals.length > 0 ? [{ file: paths.memory.evidence, expected: evidenceSnapshot, next: jsonlBuffer([...existingEvidence, ...plan.proposals.map((proposal) => proposal.evidence)]) }] : []),
      ...affectedFiles.map((file) => ({ file, expected: memorySnapshots.get(file)!, next: jsonlBuffer(updatedRows.filter((row) => row.file === file).map((row) => row.record)) })),
    ];
    const transactionPath = join(backupPath, "transaction.json");
    const transactionTargets = changes.map((change) => ({
      file: relative(root, change.file),
      backup: change.expected === null ? null : relative(backupPath, join(backupPath, relative(root, change.file))),
      existed: change.expected !== null,
    }));
    writeFileSync(transactionPath, `${JSON.stringify({ state: "prepared", targets: transactionTargets, plan_fingerprint: plan.fingerprint }, null, 2)}\n`, "utf-8");
    writeFileSync(result.report_path!, `${JSON.stringify({ ...result, mutation_performed: false, state: "prepared", plan }, null, 2)}\n`, "utf-8");
    commitMigrationFileSet(changes);
    const postApplyPlan = scanLegacyEvidenceMigration(root);
    if (postApplyPlan.evidence_to_create !== 0 || postApplyPlan.links_to_add.length !== 0) throw new Error("Legacy evidence migration post-apply preview is not idempotent.");
    const finalResult = { ...result, post_apply_evidence_to_create: postApplyPlan.evidence_to_create };
    writeFileSync(transactionPath, `${JSON.stringify({ state: "committed", targets: transactionTargets, plan_fingerprint: plan.fingerprint }, null, 2)}\n`, "utf-8");
    writeFileSync(result.report_path!, `${JSON.stringify({ ...finalResult, state: "committed", plan, post_apply_plan: postApplyPlan }, null, 2)}\n`, "utf-8");
    return finalResult;
  } finally {
    closeSync(lock);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}
