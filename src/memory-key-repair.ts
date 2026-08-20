import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { getDerivedRecordMemoryKeyV2, getRecordMemoryKeys, isExcludedLegacyMemoryKey } from "./memory-key";
import { runMemoryDiagnostics } from "./diagnostics";
import { readJsonl, writeJsonlAtomic } from "./jsonl";
import { resolvePaths } from "./paths";
import type { MemoryRecord } from "./types";

export interface MemoryKeyRepairTarget {
  id: string;
  file: string;
  ordinal: number;
  oldKey: string;
  newKey: string;
  sourceRecordHash: string;
  sourceFileHash: string;
  reason: "excluded-v1-topic";
}

export interface MemoryKeyRepairCollision {
  normalizedKey: string;
  memoryIds: string[];
}

export interface MemoryKeyRepairPlan {
  version: 2;
  dryRun: true;
  mutationPerformed: false;
  fingerprint: string;
  targetCount: number;
  affectedFileCount: number;
  applyEligible: boolean;
  targets: MemoryKeyRepairTarget[];
  collisions: MemoryKeyRepairCollision[];
  affectedFiles: Array<{ file: string; sourceFileHash: string }>;
}

interface CanonicalRow {
  absoluteFile: string;
  file: string;
  ordinal: number;
  record: MemoryRecord;
  sourceRecordHash: string;
  sourceFileHash: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalFiles(root: string): string[] {
  const paths = resolvePaths(root);
  const projects = existsSync(paths.memory.projects)
    ? readdirSync(paths.memory.projects)
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .map((name) => join(paths.memory.projects, name))
    : [];
  return [paths.memory.L1, paths.memory.L2, ...projects].filter(existsSync);
}

function readCanonicalRows(root: string): CanonicalRow[] {
  const rows: CanonicalRow[] = [];
  for (const absoluteFile of canonicalFiles(root)) {
    const bytes = readFileSync(absoluteFile);
    const sourceFileHash = sha256(bytes);
    const file = relative(root, absoluteFile);
    readJsonl<MemoryRecord>(absoluteFile).forEach((record, index) => {
      rows.push({
        absoluteFile,
        file,
        ordinal: index + 1,
        record,
        sourceRecordHash: sha256(JSON.stringify(record)),
        sourceFileHash,
      });
    });
  }
  return rows;
}

function eligibleTarget(row: CanonicalRow): MemoryKeyRepairTarget | null {
  const oldKey = row.record.normalized_key;
  if (row.record.status !== "active" || !oldKey || !isExcludedLegacyMemoryKey(oldKey)) return null;
  const newKey = getDerivedRecordMemoryKeyV2(row.record);
  if (newKey === oldKey) return null;
  return {
    id: row.record.id,
    file: row.file,
    ordinal: row.ordinal,
    oldKey,
    newKey,
    sourceRecordHash: row.sourceRecordHash,
    sourceFileHash: row.sourceFileHash,
    reason: "excluded-v1-topic",
  };
}

function findCollisions(rows: CanonicalRow[], targets: MemoryKeyRepairTarget[]): MemoryKeyRepairCollision[] {
  const targetKeys = [...new Set(targets.map((target) => target.newKey))].sort();
  return targetKeys.flatMap((normalizedKey) => {
    const memoryIds = rows
      .filter((row) => row.record.status === "active" && getRecordMemoryKeys(row.record).includes(normalizedKey))
      .map((row) => row.record.id)
      .sort();
    return memoryIds.length > 1 ? [{ normalizedKey, memoryIds }] : [];
  });
}

function fingerprintPayload(plan: Omit<MemoryKeyRepairPlan, "fingerprint">): string {
  return JSON.stringify({
    version: plan.version,
    targets: plan.targets,
    collisions: plan.collisions,
    affectedFiles: plan.affectedFiles,
    applyEligible: plan.applyEligible,
  });
}

export interface MemoryKeyRepairApplyResult {
  version: 2;
  dryRun: false;
  mutationPerformed: boolean;
  fingerprint: string;
  targetCount: number;
  changes: MemoryKeyRepairTarget[];
  backupPath?: string;
  reportPath?: string;
  postApplyTargetCount: number;
  postApplyErrors?: number;
}

export function scanMemoryKeyRepair(root: string): MemoryKeyRepairPlan {
  const rows = readCanonicalRows(root);
  const targets = rows
    .map(eligibleTarget)
    .filter((target): target is MemoryKeyRepairTarget => target !== null)
    .sort((a, b) => a.file.localeCompare(b.file) || a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  const collisions = findCollisions(rows, targets);
  const targetFiles = new Set(targets.map((target) => target.file));
  const affectedFiles = [...targetFiles]
    .sort()
    .map((file) => ({ file, sourceFileHash: targets.find((target) => target.file === file)!.sourceFileHash }));
  const withoutFingerprint: Omit<MemoryKeyRepairPlan, "fingerprint"> = {
    version: 2,
    dryRun: true,
    mutationPerformed: false,
    targetCount: targets.length,
    affectedFileCount: affectedFiles.length,
    applyEligible: collisions.length === 0,
    targets,
    collisions,
    affectedFiles,
  };
  return {
    ...withoutFingerprint,
    fingerprint: sha256(fingerprintPayload(withoutFingerprint)),
  };
}

function timestampSlug(now: string): string {
  return now.replace(/[^0-9]/g, "").slice(0, 17);
}

function stripNormalizedKey(record: MemoryRecord): Omit<MemoryRecord, "normalized_key"> {
  const { normalized_key: _normalizedKey, ...rest } = record;
  return rest;
}

function createRepairBackup(root: string, plan: MemoryKeyRepairPlan, now: string): string {
  const backupsRoot = join(root, "backups");
  mkdirSync(backupsRoot, { recursive: true });
  const backupPath = join(backupsRoot, `memory-key-repair-v2-${timestampSlug(now)}`);
  mkdirSync(backupPath, { recursive: false });

  const files = plan.affectedFiles.map((item) => {
    const source = join(root, item.file);
    const destination = join(backupPath, item.file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    const backupHash = sha256(readFileSync(destination));
    if (backupHash !== item.sourceFileHash) throw new Error(`Memory key repair backup validation failed for ${item.file}`);
    return { path: item.file, sha256: backupHash };
  });

  writeFileSync(join(backupPath, "transaction.json"), `${JSON.stringify({
    version: 2,
    createdAt: now,
    previewFingerprint: plan.fingerprint,
    files,
  }, null, 2)}\n`, "utf8");
  return backupPath;
}

export function applyMemoryKeyRepair(root: string, expectedFingerprint: string, now = new Date().toISOString()): MemoryKeyRepairApplyResult {
  if (!/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
    throw new Error("Apply requires a reviewed 64-character fingerprint.");
  }

  const plan = scanMemoryKeyRepair(root);
  if (plan.fingerprint !== expectedFingerprint) {
    throw new Error("Memory key repair preview is stale; run preview again before applying.");
  }
  if (!plan.applyEligible) {
    throw new Error("Memory key repair plan has unresolved collisions and cannot be applied.");
  }
  if (plan.targetCount === 0) {
    return {
      version: 2,
      dryRun: false,
      mutationPerformed: false,
      fingerprint: plan.fingerprint,
      targetCount: 0,
      changes: [],
      postApplyTargetCount: 0,
    };
  }

  const recordsByFile = new Map<string, MemoryRecord[]>();
  for (const file of plan.affectedFiles) {
    const path = join(root, file.file);
    if (sha256(readFileSync(path)) !== file.sourceFileHash) {
      throw new Error(`Memory key repair source file drifted: ${file.file}`);
    }
    recordsByFile.set(file.file, readJsonl<MemoryRecord>(path));
  }

  for (const target of plan.targets) {
    const record = recordsByFile.get(target.file)?.[target.ordinal - 1];
    if (!record || record.id !== target.id || record.normalized_key !== target.oldKey || sha256(JSON.stringify(record)) !== target.sourceRecordHash) {
      throw new Error(`Memory key repair source record drifted: ${target.id}`);
    }
  }

  const backupPath = createRepairBackup(root, plan, now);
  const targetsByLocation = new Map(plan.targets.map((target) => [`${target.file}:${target.ordinal}`, target]));
  for (const [file, records] of recordsByFile) {
    const updated = records.map((record, index) => {
      const target = targetsByLocation.get(`${file}:${index + 1}`);
      return target ? { ...record, normalized_key: target.newKey } : record;
    });
    writeJsonlAtomic(join(root, file), updated);
  }

  for (const [file, originalRecords] of recordsByFile) {
    const updatedRecords = readJsonl<MemoryRecord>(join(root, file));
    if (updatedRecords.length !== originalRecords.length) throw new Error(`Memory key repair row count changed for ${file}`);
    originalRecords.forEach((original, index) => {
      const updated = updatedRecords[index];
      const target = targetsByLocation.get(`${file}:${index + 1}`);
      if (target) {
        if (updated.id !== target.id || updated.normalized_key !== target.newKey) throw new Error(`Memory key repair verification failed for ${target.id}`);
        if (JSON.stringify(stripNormalizedKey(updated)) !== JSON.stringify(stripNormalizedKey(original))) {
          throw new Error(`Memory key repair changed non-key fields for ${target.id}`);
        }
      } else if (JSON.stringify(updated) !== JSON.stringify(original)) {
        throw new Error(`Memory key repair changed non-target record ${original.id}`);
      }
    });
  }

  const postApplyPlan = scanMemoryKeyRepair(root);
  if (postApplyPlan.targetCount !== 0) throw new Error("Memory key repair post-apply preview is not idempotent.");
  const diagnostics = runMemoryDiagnostics(root);
  const reportPath = join(root, "reports", `memory-key-repair-${timestampSlug(now)}.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  const result: MemoryKeyRepairApplyResult = {
    version: 2,
    dryRun: false,
    mutationPerformed: true,
    fingerprint: plan.fingerprint,
    targetCount: plan.targetCount,
    changes: plan.targets,
    backupPath,
    reportPath,
    postApplyTargetCount: postApplyPlan.targetCount,
    postApplyErrors: diagnostics.summary.errors,
  };
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}
