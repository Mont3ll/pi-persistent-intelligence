import { existsSync, rmSync } from "node:fs";
import { readCanonicalGeneration, readProjectionGeneration } from "./governance-generation";
import { acquireGovernanceWriterLock } from "./governance-writer-lock";
import {
  completeInterruptedTransaction,
  listTransactionIds,
  readTransactionManifest,
  transactionDirectory,
  validatePrivacyHistoricalInventory,
  type GovernanceTransactionManifest,
} from "./governance-transaction";
import { renderMemoryToDisk } from "./render";

export interface RecoveryReport {
  completed: string[];
  discarded: string[];
  projection_rebuilt: string[];
  blocked: Array<{ transaction_id: string; reason: string }>;
}

function recoverOne(root: string, transactionId: string, manifest: GovernanceTransactionManifest, now: string): "completed" | "already_complete" {
  if (manifest.stage === "complete") return "already_complete";
  completeInterruptedTransaction(root, manifest, now);
  return "completed";
}

export function recoverGovernanceTransactions(root: string, now: string): RecoveryReport {
  const lock = acquireGovernanceWriterLock(root, { transactionId: "__recovery__", now });
  try {
    const report: RecoveryReport = { completed: [], discarded: [], projection_rebuilt: [], blocked: [] };
    const transactionIds = listTransactionIds(root);
    // A durable privacy purge must account for every historical manifest.
    // Do not discard a missing-intent directory before the pending purge's
    // recovery has a chance to flag it as an irreconcilable source gap.
    const pendingPurgeIds = transactionIds.filter((id) => {
      try {
        const manifest = readTransactionManifest(root, id);
        return manifest?.privacy_manifest_snapshot === true && manifest.stage !== "complete";
      } catch { return false; }
    });
    for (const pendingId of pendingPurgeIds) {
      try {
        validatePrivacyHistoricalInventory(root, pendingId, true);
      } catch (error) {
        report.blocked.push({
          transaction_id: pendingId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (report.blocked.length > 0) return report;

    for (const transactionId of transactionIds) {
      const dir = transactionDirectory(root, transactionId);
      const manifest = readTransactionManifest(root, transactionId);
      if (!manifest) {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
        report.discarded.push(transactionId);
        continue;
      }
      try {
        const outcome = recoverOne(root, transactionId, manifest, now);
        if (outcome === "completed") report.completed.push(transactionId);
      } catch (error) {
        report.blocked.push({ transaction_id: transactionId, reason: error instanceof Error ? error.message : String(error) });
      }
    }

    if (report.blocked.length > 0) return report;

    const generation = readCanonicalGeneration(root);
    if (readProjectionGeneration(root, "rendered") !== generation) {
      renderMemoryToDisk(root, generation);
      report.projection_rebuilt.push("rendered");
    }
    return report;
  } finally {
    lock.release();
  }
}

export function assertGovernanceRecoveryClear(report: RecoveryReport): void {
  if (report.blocked.length === 0) return;
  const detail = report.blocked.map((item) => `${item.transaction_id}: ${item.reason}`).join("; ");
  throw new Error(`Governance recovery blocked: ${detail}`);
}
