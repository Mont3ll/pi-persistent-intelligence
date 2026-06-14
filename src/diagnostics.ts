import { existsSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readEvidenceRecords } from "./evidence";
import { ensureMemoryDirs } from "./paths";
import { isTombstonedRecord } from "./tombstones";
import { loadAllRecords } from "./store";
import { readLastInjectionStats } from "./retriever";
import { extractHardRules } from "./rules";
import { scanSecrets, redactSecrets } from "./secret-scanner";
import { checkProvenanceLiveness } from "./provenance-liveness";
import { generateReverificationRecommendations } from "./reverification";
import { inferMemoryKind } from "./memory-kind";
import type { MemoryRecord } from "./types";

export type DiagnosticSeverity = "ok" | "info" | "warning" | "error";

export interface DiagnosticFinding {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  affected_ids?: string[];
}

export interface DiagnosticsReport {
  timestamp: string;
  root: string;
  findings: DiagnosticFinding[];
  summary: {
    ok: number;
    info: number;
    warnings: number;
    errors: number;
    total_records: number;
    total_evidence: number;
  };
}

function ok(code: string, message: string): DiagnosticFinding {
  return { code, severity: "ok", message };
}
function info(code: string, message: string, ids?: string[]): DiagnosticFinding {
  return { code, severity: "info", message, affected_ids: ids };
}
function warn(code: string, message: string, ids?: string[]): DiagnosticFinding {
  return { code, severity: "warning", message, affected_ids: ids };
}
function error(code: string, message: string, ids?: string[]): DiagnosticFinding {
  return { code, severity: "error", message, affected_ids: ids };
}

export function runMemoryDiagnostics(root: string): DiagnosticsReport {
  const paths = ensureMemoryDirs(root);
  const findings: DiagnosticFinding[] = [];
  const now = new Date().toISOString();

  // 1. Required stores exist
  const requiredFiles = [paths.memory.L1, paths.memory.L2, paths.memory.profiles, paths.memory.evidence, paths.memory.tombstones, paths.inbox.captured];
  for (const file of requiredFiles) {
    if (!existsSync(file)) findings.push(warn("missing_store_file", `Expected JSONL store not found: ${file}`));
  }

  const allRecords = loadAllRecords(root);
  const allEvidence = readEvidenceRecords(root);
  const activeIds = new Set(allRecords.filter((r) => r.status === "active").map((r) => r.id));
  const allIds = new Set(allRecords.map((r) => r.id));

  // 2. Orphan evidence (references non-existent memories)
  const orphanEvidence = allEvidence.filter((ev) =>
    ev.related_memory_ids.length > 0 &&
    ev.related_memory_ids.every((id) => !allIds.has(id)) &&
    ev.redaction_status !== "deleted",
  );
  if (orphanEvidence.length > 0) {
    findings.push(warn("orphan_evidence", `${orphanEvidence.length} evidence record(s) reference non-existent memory IDs.`, orphanEvidence.map((e) => e.id)));
  } else {
    findings.push(ok("orphan_evidence", "No orphan evidence records."));
  }

  // 3. Tombstoned records appearing in the store with active status
  const zombied = allRecords.filter((r) =>
    r.status === "active" &&
    isTombstonedRecord(root, r.id),
  );
  if (zombied.length > 0) {
    findings.push(error("tombstoned_in_active_store", `${zombied.length} record(s) are tombstoned but still have status:active in the JSONL store.`, zombied.map((r) => r.id)));
  } else {
    findings.push(ok("tombstoned_in_active_store", "No active records have tombstones."));
  }

  // 4. Contested records appearing in hard-rule candidates
  const hardRuleCandidates = extractHardRules(allRecords);
  const contestedHardRuleConflict = allRecords.filter((r) => r.status === "contested" &&
    hardRuleCandidates.some((hr) => hr.id === r.id));
  if (contestedHardRuleConflict.length > 0) {
    findings.push(error("contested_in_hard_rule_candidate", `${contestedHardRuleConflict.length} contested record(s) appear in hard-rule candidates — extractHardRules filter may be broken.`, contestedHardRuleConflict.map((r) => r.id)));
  } else {
    // Also check: any high-confidence contested records that WOULD qualify except for status
    const wouldBeHardRule = allRecords.filter((r) => r.status === "contested" && r.confidence >= 0.85 && r.ruleType);
    if (wouldBeHardRule.length > 0) {
      findings.push(info("contested_in_hard_rule_candidate", `${wouldBeHardRule.length} contested record(s) would qualify as hard rules if active — verify status is intentional.`, wouldBeHardRule.map((r) => r.id)));
    } else {
      findings.push(ok("contested_in_hard_rule_candidate", "No contested records in hard-rule path."));
    }
  }

  // 5. Deleted records in rendered Markdown
  const renderedPath = join(root, "rendered", "MEMORY.md");
  if (existsSync(renderedPath)) {
    const rendered = require("node:fs").readFileSync(renderedPath, "utf-8");
    const deletedIds = allRecords.filter((r) => r.status === "deleted").map((r) => r.id);
    const leaked = deletedIds.filter((id) => rendered.includes(id));
    if (leaked.length > 0) findings.push(error("deleted_in_rendered", `${leaked.length} deleted record ID(s) appear in rendered/MEMORY.md.`, leaked));
    else findings.push(ok("deleted_in_rendered", "No deleted records in rendered Markdown."));
  } else {
    findings.push(info("deleted_in_rendered", "rendered/MEMORY.md not found — projection not yet generated."));
  }

  // 6. Legacy records missing profile_id / normalized_key / trust fields
  const legacy = allRecords.filter((r) => !r.profile_id || !(r as any).normalized_key);
  if (legacy.length > 0) {
    findings.push(info("legacy_missing_fields", `${legacy.length} record(s) are missing profile_id or normalized_key (pre-0.8.0 records). Compatibility mode handles them safely.`, legacy.map((r) => r.id)));
  } else {
    findings.push(ok("legacy_missing_fields", "All records have profile_id and normalized_key."));
  }

  // 7. Duplicate normalized keys within a profile
  const keyMap = new Map<string, string[]>();
  for (const r of allRecords.filter((rec) => rec.status === "active")) {
    const key = `${r.profile_id ?? "legacy"}|${(r as any).normalized_key ?? ""}`;
    if (!(r as any).normalized_key) continue;
    if (!keyMap.has(key)) keyMap.set(key, []);
    keyMap.get(key)!.push(r.id);
  }
  const duplicateKeys = [...keyMap.entries()].filter(([, ids]) => ids.length > 1);
  if (duplicateKeys.length > 0) {
    findings.push(warn("duplicate_normalized_keys", `${duplicateKeys.length} normalized key(s) have multiple active records — potential conflict.`, duplicateKeys.flatMap(([, ids]) => ids)));
  } else {
    findings.push(ok("duplicate_normalized_keys", "No duplicate normalized keys within profiles."));
  }

  // 8. Active L2 records referencing redacted/deleted evidence
  const redactedEvidenceIds = new Set(allEvidence.filter((ev) => ev.redaction_status === "deleted" || ev.redaction_status === "redacted").map((ev) => ev.id));
  const activeWithRedactedEvidence = allRecords.filter((r) =>
    r.status === "active" &&
    r.evidence.some((ev) => redactedEvidenceIds.has(ev.ref)),
  );
  if (activeWithRedactedEvidence.length > 0) {
    findings.push(warn("active_record_redacted_evidence", `${activeWithRedactedEvidence.length} active record(s) reference redacted or deleted evidence IDs.`, activeWithRedactedEvidence.map((r) => r.id)));
  } else {
    findings.push(ok("active_record_redacted_evidence", "No active records reference redacted/deleted evidence."));
  }

  // 9. Secret-like content in canonical stores. Messages never include raw matches.
  const secretAffected: string[] = [];
  for (const record of allRecords) {
    if (scanSecrets(JSON.stringify(record)).hasHighConfidenceSecret) secretAffected.push(record.id);
  }
  for (const evidence of allEvidence) {
    if (scanSecrets(JSON.stringify(evidence)).hasHighConfidenceSecret) secretAffected.push(evidence.id);
  }
  if (secretAffected.length > 0) findings.push(error("secret_like_content_detected", `${secretAffected.length} record(s) contain high-confidence secret-like content. Values redacted from diagnostics.`, secretAffected));
  else findings.push(ok("secret_like_content_detected", "No high-confidence secret-like content detected in memory or evidence stores."));

  // 10. Provenance liveness and dependency re-verification.
  const liveness = checkProvenanceLiveness(root, now);
  for (const finding of liveness.findings) {
    const ids = [finding.memory_id, finding.evidence_id].filter((id): id is string => Boolean(id));
    findings.push(finding.severity === "error" ? error(finding.code, finding.message, ids) : warn(finding.code, finding.message, ids));
  }
  const reverify = generateReverificationRecommendations(root);
  if (reverify.length > 0) findings.push(warn("reverification_recommended", `${reverify.length} memory record(s) should be re-verified due to invalidated dependencies.`, reverify.map((r) => r.memory_id)));
  else findings.push(ok("reverification_recommended", "No dependency-based re-verification recommendations."));

  // 11. Public memory kind taxonomy coverage.
  const kindCounts = allRecords.reduce<Record<string, number>>((counts, record) => {
    const kind = record.memory_kind ?? inferMemoryKind(record);
    counts[kind] = (counts[kind] ?? 0) + 1;
    return counts;
  }, {});
  findings.push(info("memory_kind_taxonomy", `Memory kinds: fact=${kindCounts.fact ?? 0}, event=${kindCounts.event ?? 0}, instruction=${kindCounts.instruction ?? 0}, task=${kindCounts.task ?? 0}.`));

  // 12. Last injection budget metadata, when available.
  const stats = readLastInjectionStats(root);
  if (stats) findings.push(info("last_injection_stats", `Last injection mode ${stats.injectionMode}; ${stats.charCount} chars; selected=${stats.selectedMemoryCount}; hard_rules=${stats.hardRuleCount}; contested=${stats.contestedMemoryCount}; inquiries=${stats.inquiryCount}.`));
  else findings.push(info("last_injection_stats", "No runtime injection stats recorded yet."));

  const summary = {
    ok: findings.filter((f) => f.severity === "ok").length,
    info: findings.filter((f) => f.severity === "info").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    errors: findings.filter((f) => f.severity === "error").length,
    total_records: allRecords.length,
    total_evidence: allEvidence.length,
  };

  return { timestamp: now, root, findings, summary };
}

export function renderDiagnosticsReport(report: DiagnosticsReport): string {
  const icons: Record<DiagnosticSeverity, string> = { ok: "✓", info: "ℹ", warning: "⚠️", error: "✗" };
  const lines = [
    `PI Memory Diagnostics — ${report.timestamp}`,
    `Root: ${report.root}`,
    `Records: ${report.summary.total_records}  Evidence: ${report.summary.total_evidence}`,
    `Summary: ${report.summary.ok} ok  ${report.summary.info} info  ${report.summary.warnings} warnings  ${report.summary.errors} errors`,
    "",
  ];
  for (const f of report.findings.filter((f) => f.severity !== "ok")) {
    lines.push(redactSecrets(`${icons[f.severity]} [${f.severity}] ${f.code}: ${f.message}`));
    if (f.affected_ids?.length) lines.push(`  Affected: ${f.affected_ids.slice(0, 5).join(", ")}${f.affected_ids.length > 5 ? "..." : ""}`);
  }
  if (report.summary.errors === 0 && report.summary.warnings === 0 && report.summary.info === 0) lines.push("✓ All checks passed.");
  return lines.join("\n");
}

export function saveDiagnosticsReport(root: string, report: DiagnosticsReport): string {
  const reportDir = join(root, "reports", "diagnostics");
  mkdirSync(reportDir, { recursive: true });
  const stamp = report.timestamp.replace(/[:.]/g, "-").slice(0, 19);
  const jsonPath = join(reportDir, `${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  return jsonPath;
}
