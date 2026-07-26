import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { auditCaptureHistory } from "./capture-audit";
import { createCaptureBackfillBackup } from "./capture-backup";
import { appendOrReinforceCandidate, normalizedPreferenceKey } from "./capture-recurrence";
import { buildCandidateTrustMetadata } from "./trust";
import type { CaptureCandidate } from "./types";

export interface CaptureBackfillPreview {
  generated_at: string;
  since?: string;
  mutation_performed: false;
  fingerprint: string;
  candidates: CaptureCandidate[];
  contaminated_record_ids: string[];
  rescope_record_ids: string[];
}

export interface CaptureBackfillApplyResult {
  generated_at: string;
  mutation_performed: true;
  fingerprint: string;
  backup_path: string;
  candidates_created: number;
  candidates_reinforced: number;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function candidateFromFinding(finding: ReturnType<typeof auditCaptureHistory>["historical_preferences"][number], now: string): CaptureCandidate {
  const trust = buildCandidateTrustMetadata("agent_inference", finding.proposed_scope.type === "global" ? "user_global" : "project");
  const intent = finding.intent;
  return {
    id: `cap_backfill_${finding.source_hash.slice(0, 20)}`,
    created_at: now,
    source: { type: "historical_session_audit", ref: finding.source_ref },
    text: finding.excerpt,
    tags: [...new Set(["capture-backfill", intent, ...finding.applicability])],
    evidence_refs: [finding.source_ref],
    confidence: finding.confidence,
    status: "new",
    ruleType: intent === "user_preference" ? (/\bavoid/i.test(finding.excerpt) ? "avoid_pattern" : "preference") : intent === "project_convention" ? "convention" : intent === "workflow_playbook" ? "workflow" : "correction",
    memory_kind: "instruction",
    ...trust,
    promotion_eligibility: "review_only",
    capture_group_id: `capture_group_backfill_${finding.source_hash.slice(0, 16)}`,
    capture_intent: intent,
    scope_targets: [finding.proposed_scope],
    normalized_preference_key: normalizedPreferenceKey(finding.excerpt, intent),
    recurrence_count: 1,
    source_session_ids: [finding.source_ref],
    source_turn_ids: [],
    activity_evidence_ids: [],
    proposed_applies_when: finding.applicability,
  };
}

function fingerprintPayload(since: string | undefined, candidates: CaptureCandidate[], contaminated: string[], rescope: string[]): string {
  return JSON.stringify({
    since: since ?? null,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      text_hash: hash(candidate.text),
      intent: candidate.capture_intent,
      scope_targets: candidate.scope_targets,
      applies_when: candidate.proposed_applies_when,
      source: candidate.source.ref,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    contaminated: [...contaminated].sort(),
    rescope: [...rescope].sort(),
  });
}

export function previewCaptureBackfill(root: string, options: { since?: string; now?: string } = {}): CaptureBackfillPreview {
  const generatedAt = options.now ?? new Date().toISOString();
  const audit = auditCaptureHistory(root, { since: options.since, now: generatedAt });
  const candidates = audit.historical_preferences.map((finding) => candidateFromFinding(finding, generatedAt)).sort((a, b) => a.id.localeCompare(b.id));
  const rescope = audit.rescope_proposals.map((item) => item.record_id);
  const payload = fingerprintPayload(options.since, candidates, audit.contaminated_record_ids, rescope);
  return {
    generated_at: generatedAt,
    since: options.since,
    mutation_performed: false,
    fingerprint: hash(payload),
    candidates,
    contaminated_record_ids: audit.contaminated_record_ids,
    rescope_record_ids: rescope,
  };
}

export function saveCaptureBackfillPreview(root: string, preview: CaptureBackfillPreview, filename: string): string {
  if (!filename || basename(filename) !== filename || !filename.endsWith(".json")) throw new Error("Invalid capture preview filename");
  const path = join(root, "reports", filename);
  writeFileSync(path, `${JSON.stringify(preview, null, 2)}\n`, "utf-8");
  return path;
}

export function applyCaptureBackfill(root: string, options: { since?: string; fingerprint: string; now?: string }): CaptureBackfillApplyResult {
  if (!options.fingerprint) throw new Error("Backfill fingerprint is required");
  const now = options.now ?? new Date().toISOString();
  const preview = previewCaptureBackfill(root, { since: options.since, now });
  if (preview.fingerprint !== options.fingerprint) throw new Error("Backfill source drift detected");
  const backupPath = createCaptureBackfillBackup(root, preview.fingerprint, now);
  let created = 0;
  let reinforced = 0;
  for (const candidate of preview.candidates) {
    const result = appendOrReinforceCandidate(root, candidate);
    if (result.action === "created") created++;
    else reinforced++;
  }
  return {
    generated_at: now,
    mutation_performed: true,
    fingerprint: preview.fingerprint,
    backup_path: backupPath,
    candidates_created: created,
    candidates_reinforced: reinforced,
  };
}
