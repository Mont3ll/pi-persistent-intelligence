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
  contaminated_candidate_ids: string[];
  rescope_record_ids: string[];
  skipped_ambiguous_scope_count: number;
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

function groupBackfillCandidates(candidates: CaptureCandidate[]): CaptureCandidate[] {
  const grouped = new Map<string, CaptureCandidate>();
  for (const candidate of candidates.sort((a, b) => `${a.source.ref}:${a.id}`.localeCompare(`${b.source.ref}:${b.id}`))) {
    const scopeKey = JSON.stringify((candidate.scope_targets ?? []).map((target) => ({ type: target.type, project: target.project, domain: target.domain })));
    const key = `${candidate.normalized_preference_key}:${scopeKey}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, candidate);
      continue;
    }
    grouped.set(key, {
      ...existing,
      recurrence_count: (existing.recurrence_count ?? 1) + (candidate.recurrence_count ?? 1),
      evidence_refs: [...new Set([...existing.evidence_refs, ...candidate.evidence_refs])],
      source_session_ids: [...new Set([...(existing.source_session_ids ?? []), ...(candidate.source_session_ids ?? [])])],
      primary_trust_class: "repeated_user_preference",
      source_trust_weight: 0.9,
    });
  }
  return [...grouped.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function fingerprintPayload(since: string | undefined, candidates: CaptureCandidate[], contaminated: string[], contaminatedCandidates: string[], rescope: string[], skippedAmbiguousScope: string[]): string {
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
    contaminated_candidates: [...contaminatedCandidates].sort(),
    rescope: [...rescope].sort(),
    skipped_ambiguous_scope: [...skippedAmbiguousScope].sort(),
  });
}

export function previewCaptureBackfill(root: string, options: { since?: string; now?: string } = {}): CaptureBackfillPreview {
  const generatedAt = options.now ?? new Date().toISOString();
  const audit = auditCaptureHistory(root, { since: options.since, now: generatedAt });
  const safelyScoped = audit.historical_preferences.filter((finding) => finding.proposed_scope.type === "global"
    || (finding.proposed_scope.type === "project" && Boolean(finding.proposed_scope.project))
    || (finding.proposed_scope.type === "domain" && Boolean(finding.proposed_scope.domain)));
  const ambiguousScope = audit.historical_preferences.filter((finding) => !safelyScoped.includes(finding));
  const candidates = groupBackfillCandidates(safelyScoped.map((finding) => candidateFromFinding(finding, generatedAt)));
  const rescope = audit.rescope_proposals.map((item) => item.record_id);
  const payload = fingerprintPayload(options.since, candidates, audit.contaminated_record_ids, audit.contaminated_candidate_ids, rescope, ambiguousScope.map((finding) => finding.source_hash));
  return {
    generated_at: generatedAt,
    since: options.since,
    mutation_performed: false,
    fingerprint: hash(payload),
    candidates,
    contaminated_record_ids: audit.contaminated_record_ids,
    contaminated_candidate_ids: audit.contaminated_candidate_ids,
    rescope_record_ids: rescope,
    skipped_ambiguous_scope_count: ambiguousScope.length,
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
