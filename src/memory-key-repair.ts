import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { getDerivedRecordMemoryKeyV2, getRecordMemoryKeys, isExcludedLegacyMemoryKey } from "./memory-key";
import { readJsonl } from "./jsonl";
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
