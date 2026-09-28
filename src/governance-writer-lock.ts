import { closeSync, existsSync, fsyncSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { readCanonicalGeneration } from "./governance-generation";
import { ensureMemoryDirs } from "./paths";

export class GovernanceWriterBusyError extends Error {
  constructor(message = "Governance writer lock is already held") {
    super(message);
    this.name = "GovernanceWriterBusyError";
  }
}

export class StaleCanonicalGenerationError extends Error {
  constructor(expected: number, actual: number) {
    super(`Stale canonical generation: expected ${expected}, found ${actual}`);
    this.name = "StaleCanonicalGenerationError";
  }
}

export interface GovernanceWriterLockHandle {
  path: string;
  transactionId: string;
  observedGeneration: number;
  release(): void;
}

export interface AcquireGovernanceWriterLockOptions {
  transactionId: string;
  expectedGeneration?: number;
  now: string;
}

export function readGovernanceWriterLock(root: string): Record<string, unknown> | null {
  const path = ensureMemoryDirs(root).governance.writerLock;
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; } catch { return { malformed: true }; }
}

function ownerIsDead(lock: Record<string, unknown> | null): boolean {
  const pid = typeof lock?.pid === "number" && Number.isInteger(lock.pid) && lock.pid > 0 ? lock.pid : null;
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    return code === "ESRCH";
  }
}

function openLock(path: string): number {
  try {
    return openSync(path, "wx", 0o600);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code !== "EEXIST") throw error;
    let lock: Record<string, unknown> | null = null;
    try { lock = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; } catch { /* fail closed below */ }
    if (!ownerIsDead(lock)) throw new GovernanceWriterBusyError();
    unlinkSync(path);
    try { return openSync(path, "wx", 0o600); } catch { throw new GovernanceWriterBusyError(); }
  }
}

export function acquireGovernanceWriterLock(root: string, options: AcquireGovernanceWriterLockOptions): GovernanceWriterLockHandle {
  const path = ensureMemoryDirs(root).governance.writerLock;
  const fd = openLock(path);
  let released = false;
  try {
    const observedGeneration = readCanonicalGeneration(root);
    if (options.expectedGeneration !== undefined && options.expectedGeneration !== observedGeneration) {
      throw new StaleCanonicalGenerationError(options.expectedGeneration, observedGeneration);
    }
    const payload = {
      pid: process.pid,
      transaction_id: options.transactionId,
      acquired_at: options.now,
      observed_generation: observedGeneration,
    };
    writeSync(fd, `${JSON.stringify(payload, null, 2)}\n`, undefined, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    return {
      path,
      transactionId: options.transactionId,
      observedGeneration,
      release(): void {
        if (released) return;
        released = true;
        if (existsSync(path)) unlinkSync(path);
      },
    };
  } catch (error) {
    try { closeSync(fd); } catch { /* already closed */ }
    if (existsSync(path)) unlinkSync(path);
    throw error;
  }
}
