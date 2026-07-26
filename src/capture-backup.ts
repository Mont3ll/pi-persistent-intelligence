import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

interface BackupManifest {
  version: 1;
  created_at: string;
  preview_fingerprint: string;
  files: Array<{ path: string; sha256: string }>;
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isFile()) result.push(path);
  }
  return result.sort();
}

export function createCaptureBackfillBackup(root: string, previewFingerprint: string, now: string): string {
  const slug = now.replace(/[^0-9]/g, "").slice(0, 17);
  const backupsRoot = join(root, "backups");
  mkdirSync(backupsRoot, { recursive: true });
  const backupPath = join(backupsRoot, `capture-backfill-v1-${slug}-pid${process.pid}-${randomBytes(4).toString("hex")}`);
  mkdirSync(backupPath, { recursive: false });
  const sources = ["inbox", "memory", "patches", "reports", join("sessions", "session-index.jsonl"), join("runtime", "capture")];
  for (const source of sources) {
    const from = join(root, source);
    if (!existsSync(from)) continue;
    const destination = join(backupPath, source);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(from, destination, { recursive: statSync(from).isDirectory() });
  }
  const files = filesUnder(backupPath).map((path) => ({ path: relative(backupPath, path), sha256: hashFile(path) }));
  const manifest: BackupManifest = { version: 1, created_at: now, preview_fingerprint: previewFingerprint, files };
  writeFileSync(join(backupPath, "transaction.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  validateCaptureBackfillBackup(root, backupPath);
  return backupPath;
}

export function validateCaptureBackfillBackup(root: string, backupPath: string): void {
  const backupRoot = resolve(root, "backups");
  const resolvedBackup = resolve(backupPath);
  if (resolvedBackup !== backupRoot && !resolvedBackup.startsWith(`${backupRoot}/`)) throw new Error("Capture backup path escapes the backup root");
  const manifestPath = join(resolvedBackup, "transaction.json");
  if (!existsSync(manifestPath)) throw new Error("Capture backup manifest is missing");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as BackupManifest;
  for (const item of manifest.files) {
    const path = resolve(resolvedBackup, item.path);
    if (!path.startsWith(`${resolvedBackup}/`)) throw new Error("Capture backup manifest contains path traversal");
    if (!existsSync(path) || hashFile(path) !== item.sha256) throw new Error(`Capture backup validation failed for ${item.path}`);
  }
}
