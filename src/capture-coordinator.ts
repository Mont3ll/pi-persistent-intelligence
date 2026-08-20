import { createHash } from "node:crypto";
import { appendSessionActivity, collectSessionActivity, type CaptureActivityAction } from "./capture-activity";
import { hasProcessedMessage, readCaptureCheckpoint, writeCaptureCheckpoint } from "./capture-checkpoint";
import { classifyCaptureIntent } from "./capture-intent";
import { appendOrReinforceCandidate, normalizedPreferenceKey } from "./capture-recurrence";
import { resolveCaptureScopes } from "./capture-scope";
import { loadConfig } from "./config";
import { appendDailyLog } from "./daily";
import { appendEvidenceRecord } from "./evidence";
import { readJsonl, writeJsonl } from "./jsonl";
import { scoreMemoryWorth } from "./memory-worth";
import { ensureMemoryDirs } from "./paths";
import { resolveProjectIdentity } from "./profile";
import { scanSecrets, shouldBlockPersistence } from "./secret-scanner";
import { buildCandidateTrustMetadata } from "./trust";
import type { CaptureCandidate, CaptureEventOutcome, CaptureIntent, CaptureScopeTarget, MemoryRuleType, ProjectIdentity } from "./types";

export interface CaptureTurnInput {
  session_id: string;
  turn_id: string;
  message: string;
  launch_cwd: string;
  actions: CaptureActivityAction[];
  resolver?: (path: string) => ProjectIdentity;
  explicit_project_mentions?: string[];
  now?: string;
}

export interface CaptureTurnResult {
  processed_turn_id: string;
  candidates_created: number;
  candidates_reinforced: number;
  daily_only: number;
  rejected: number;
  skipped_checkpointed: boolean;
}

export interface CaptureEvent {
  id: string;
  session_id: string;
  turn_id: string;
  message_hash: string;
  outcome: CaptureEventOutcome;
  intent: CaptureIntent;
  reason: string;
  scope_types: string[];
  created_at: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function appendCaptureEvent(root: string, event: CaptureEvent): void {
  const paths = ensureMemoryDirs(root);
  const config = loadConfig(root);
  const rows = readJsonl<CaptureEvent>(paths.runtime.captureEvents).filter((item) => item.id !== event.id);
  rows.push(event);
  writeJsonl(paths.runtime.captureEvents, rows.slice(-config.capture.activityRetentionCount));
}

export function listCaptureEvents(root: string): CaptureEvent[] {
  return readJsonl<CaptureEvent>(ensureMemoryDirs(root).runtime.captureEvents);
}

function candidateRuleType(intent: CaptureIntent, text: string): MemoryRuleType {
  if (intent === "user_preference") return /\bavoid(?:ing)?\b/i.test(text) ? "avoid_pattern" : "preference";
  if (intent === "project_convention") return "convention";
  if (intent === "workflow_playbook") return "workflow";
  return "correction";
}

function globalTarget(scopes: CaptureScopeTarget[]): boolean {
  return scopes.some((scope) => scope.type === "global");
}

function emptyResult(turnId: string): CaptureTurnResult {
  return { processed_turn_id: turnId, candidates_created: 0, candidates_reinforced: 0, daily_only: 0, rejected: 0, skipped_checkpointed: false };
}

export function processCaptureTurn(root: string, input: CaptureTurnInput): CaptureTurnResult {
  const now = input.now ?? new Date().toISOString();
  const messageHash = hash(input.message.trim());
  const processingHash = hash(`${input.turn_id}:${input.message.trim()}`);
  const checkpoint = readCaptureCheckpoint(root, input.session_id);
  if (hasProcessedMessage(checkpoint, processingHash)) return { ...emptyResult(input.turn_id), skipped_checkpointed: true };

  const config = loadConfig(root);
  const activity = collectSessionActivity({
    session_id: input.session_id,
    turn_id: input.turn_id,
    launch_cwd: input.launch_cwd,
    actions: input.actions,
    resolver: input.resolver,
    explicit_project_mentions: input.explicit_project_mentions,
    now,
  });
  appendSessionActivity(root, activity, config);

  const result = emptyResult(input.turn_id);
  const intent = classifyCaptureIntent(input.message);
  let outcome: CaptureEventOutcome = "rejected";
  let reason = intent.reasons[0] ?? "not_memory";
  let scopes: CaptureScopeTarget[] = [];

  if (shouldBlockPersistence(scanSecrets(input.message))) {
    result.rejected++;
    reason = "secret_detected";
  } else if (intent.intent === "temporary_instruction") {
    appendDailyLog(root, now.slice(0, 10), `<!-- ${now} -->\n## Temporary preference\n- ${input.message.trim().slice(0, 300)}`);
    result.daily_only++;
    outcome = "daily_only";
    reason = "temporary_instruction";
  } else if (intent.intent === "not_memory") {
    result.rejected++;
  } else {
    scopes = resolveCaptureScopes({
      text: input.message,
      decision: intent,
      launch_project: (input.resolver ?? resolveProjectIdentity)(input.launch_cwd),
      activity: [activity],
    });
    const durability = globalTarget(scopes) ? "user_global" : "project";
    const trustClass = intent.intent === "behavior_correction" ? "user_correction" : "direct_user_instruction";
    const trust = buildCandidateTrustMetadata(trustClass, durability);
    const worth = scoreMemoryWorth({
      observation: input.message,
      explicitUserRequest: true,
      durability: globalTarget(scopes) ? "long_term" : "project",
      scope: scopes.map((scope) => scope.project ?? scope.type).join(","),
      evidenceStrength: 0.9,
      operationalImpact: intent.intent === "user_preference" ? 0.6 : 0.8,
    });
    const key = normalizedPreferenceKey(input.message, intent.intent);
    const groupHash = hash(`${messageHash}:${input.session_id}`).slice(0, 20);
    const sourceRef = `session:${input.session_id}:turn:${input.turn_id}`;
    const evidence = appendEvidenceRecord(root, {
      id: "",
      resource_id: "curation",
      profile_id: "legacy-default",
      created_at: now,
      source_kind: "conversation",
      source_session_id: input.session_id,
      source_ref: sourceRef,
      source_summary: input.message.trim().slice(0, 300).replace(/\s+/g, " "),
      trust_class: trustClass,
      polarity: "supports",
      durability_signal: durability,
      related_memory_ids: [],
      scope_level: scopes.length === 1 ? scopes[0].type : "multi",
      tags: ["capture-evidence"],
      notes: "capture_evidence_v1",
    });
    const candidate: CaptureCandidate = {
      id: `cap_pref_${groupHash}`,
      created_at: now,
      source: { type: trustClass, ref: sourceRef },
      text: input.message.trim().slice(0, 300).replace(/\s+/g, " "),
      tags: [...new Set(["capture", intent.intent, ...intent.applicability])],
      evidence_refs: [evidence.id],
      evidence_ids: [evidence.id],
      confidence: intent.confidence,
      status: "new",
      ruleType: candidateRuleType(intent.intent, input.message),
      memory_kind: "instruction",
      worth_decision: worth.decision,
      worth_score: worth.worth_score,
      worth_reasons: worth.reasons,
      ...trust,
      promotion_eligibility: globalTarget(scopes) ? "review_only" : trust.promotion_eligibility,
      capture_group_id: `capture_group_${groupHash}`,
      capture_intent: intent.intent,
      scope_targets: scopes,
      normalized_preference_key: key,
      recurrence_count: 1,
      source_session_ids: [input.session_id],
      source_turn_ids: [`${input.session_id}:${input.turn_id}`],
      activity_evidence_ids: [activity.id],
      proposed_applies_when: intent.applicability,
    };
    const persisted = appendOrReinforceCandidate(root, candidate);
    if (persisted.action === "created") {
      result.candidates_created++;
      outcome = "candidate_created";
    } else {
      result.candidates_reinforced++;
      outcome = "candidate_reinforced";
    }
    reason = intent.reasons[0] ?? "captured";
  }

  appendCaptureEvent(root, {
    id: `capture_event_${hash(`${input.session_id}:${input.turn_id}:${messageHash}`).slice(0, 20)}`,
    session_id: input.session_id,
    turn_id: input.turn_id,
    message_hash: messageHash,
    outcome,
    intent: intent.intent,
    reason,
    scope_types: scopes.map((scope) => scope.type),
    created_at: now,
  });
  writeCaptureCheckpoint(root, {
    session_id: input.session_id,
    last_turn_id: input.turn_id,
    processed_message_hashes: [...(checkpoint?.processed_message_hashes ?? []), processingHash],
    updated_at: now,
  });
  return result;
}
