import { listCandidates, replaceCandidates } from "./inbox";
import { readEvidenceRecords } from "./evidence";
import { hasSemanticReviewLineage } from "./semantic-lineage";
import { loadActiveRecords } from "./store";
import { detectTaskCategories } from "./capture-applicability";
import { negativeScopeProcessor, positiveApplicabilityProcessor } from "./processors";
import { defaultResourceId } from "./profile";
import type { CaptureCandidate, CaptureIntent, CaptureScopeTarget, MemoryRecord, SessionContext } from "./types";

function canonicalScopes(scopes: CaptureScopeTarget[] | undefined): string {
  return JSON.stringify((scopes ?? []).map((scope) => ({ type: scope.type, project: scope.project, domain: scope.domain }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

export function normalizedPreferenceKey(text: string, intent: CaptureIntent): string {
  const normalized = text.toLowerCase()
    .replace(/em[ -]?dashes?/g, "em dash")
    .replace(/en[ -]?dashes?/g, "en dash")
    .replace(/\b(?:please|always|never|avoid|avoiding|do not|don't|use|prefer|my preference is|i prefer|when writing for me|for all my writing|entirely)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return `${intent}:${normalized}`;
}

/**
 * Conservative canonical equivalence gate: exact normalized statement and
 * exact single-scope identity. Do NOT reuse normalizedPreferenceKey here:
 * that older, loose preference key removes negations ("never", "do not")
 * and can collapse genuinely conflicting user corrections.
 *
 * A source turn matching an already-active canonical fact should not create
 * another pending memory. This is detection only, not an ungoverned canonical
 * reinforcement or mutation. Multi-target and profile-ambiguous matches are
 * deliberately left for governed review.
 */
function exactStatement(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function matchesCanonicalScope(record: MemoryRecord, target: CaptureScopeTarget): boolean {
  if (target.type !== record.scope.type) return false;
  if (target.type === "global") return true;
  if (target.type === "project") return Boolean(target.project && record.scope.type === "project" && target.project === record.scope.project);
  if (target.type === "domain") {
    return Boolean(target.domain && record.scope.type === "domain"
      && record.scope.domains?.length === 1 && record.scope.domains[0] === target.domain);
  }
  return false;
}

export interface CanonicalCaptureContext {
  session_id: string;
  launch_cwd: string;
  /** Resolved launch-project identity, not inferred from a memory statement. */
  project_id: string;
  recent_files_touched?: string[];
}

export function findExactActiveCanonical(
  root: string,
  originalUserText: string,
  scopes: CaptureScopeTarget[] | undefined,
  context: CanonicalCaptureContext,
): MemoryRecord | null {
  if (scopes?.length !== 1 || originalUserText.length > 300) return null;
  const [target] = scopes;
  if (!target || target.type === "session") return null;

  const resourceId = defaultResourceId();
  const sessionContext: SessionContext = {
    resource_id: resourceId,
    profile_id: "legacy-default",
    thread_id: context.session_id,
    project_root: context.launch_cwd,
    repository_id: context.project_id,
    working_directory: context.launch_cwd,
    latest_user_message: originalUserText,
    recent_files_touched: context.recent_files_touched ?? [],
    detected_domain_tags: detectTaskCategories(originalUserText, context.recent_files_touched ?? []),
    is_trivial_prompt: false,
  };
  const normalized = exactStatement(originalUserText);
  return loadActiveRecords(root).find((record) => {
    // Do not silently deduplicate across users, resources or explicit profiles.
    // Unaddressed legacy records retain their historical scope compatibility.
    if (record.resource_id && record.resource_id !== resourceId) return false;
    if (record.profile_id && record.profile_id !== "legacy-default") return false;
    if (!matchesCanonicalScope(record, target) || exactStatement(record.statement) !== normalized) return false;

    // A matching stored statement does not represent the user's current
    // context if retrieval would exclude it by positive/negative applicability.
    // Reuse the actual governed processor semantics, not another ad-hoc
    // phrase matcher that could drift from retrieval behavior.
    if (positiveApplicabilityProcessor([record], sessionContext).records.length === 0) return false;
    if (negativeScopeProcessor([record], sessionContext).records.length === 0) return false;
    return true;
  }) ?? null;
}

export function findEquivalentCandidate(
  root: string, key: string, scopes: CaptureScopeTarget[] | undefined,
): CaptureCandidate | null {
  const expectedScopes = canonicalScopes(scopes);
  const evidence = readEvidenceRecords(root);
  // Generic recurrence must never absorb a review-only semantic source.
  // Otherwise a source-v2 reference becomes a second ordinary reference
  // and silently crosses the configured auto-apply floor.
  return listCandidates(root).find((candidate) =>
    candidate.status === "new"
    && !hasSemanticReviewLineage(candidate, evidence)
    && candidate.normalized_preference_key === key
    && canonicalScopes(candidate.scope_targets) === expectedScopes
  ) ?? null;
}

export function appendOrReinforceCandidate(root: string, incoming: CaptureCandidate): { action: "created" | "reinforced"; candidate: CaptureCandidate } {
  const key = incoming.normalized_preference_key ?? normalizedPreferenceKey(incoming.text, incoming.capture_intent ?? "behavior_correction");
  const rows = listCandidates(root);
  const evidence = readEvidenceRecords(root);
  const semanticIncoming = hasSemanticReviewLineage(incoming, evidence);
  const exactNew = rows.find((candidate) => candidate.id === incoming.id && candidate.status === "new");
  const exactTerminal = rows.find((candidate) => candidate.id === incoming.id && candidate.status !== "new");
  // Source-v2 candidates are proposition-specific; a textual recurrence
  // equivalence cannot authorize merging them with generic legacy memory.
  // An exact retry is a no-op, not additional independent evidence.
  const existing = exactNew ?? exactTerminal
    ?? (semanticIncoming ? null : findEquivalentCandidate(root, key, incoming.scope_targets));
  if (!existing) {
    const candidate = { ...incoming, normalized_preference_key: key, recurrence_count: incoming.recurrence_count ?? 1 };
    rows.push(candidate);
    replaceCandidates(root, rows);
    return { action: "created", candidate };
  }

  if (existing.status !== "new") return { action: "reinforced", candidate: existing };
  if (semanticIncoming || hasSemanticReviewLineage(existing, evidence)) {
    if (existing.id !== incoming.id) {
      throw new Error("semantic_lineage_recurring_source_mismatch");
    }
    // Never increment recurrence_count or append evidence on replay.
    return { action: "reinforced", candidate: existing };
  }

  const updated: CaptureCandidate = {
    ...existing,
    recurrence_count: (existing.recurrence_count ?? 1) + (incoming.recurrence_count ?? 1),
    evidence_refs: [...new Set([...existing.evidence_refs, ...incoming.evidence_refs])],
    evidence_ids: [...new Set([...(existing.evidence_ids ?? []), ...(incoming.evidence_ids ?? [])])],
    source_session_ids: [...new Set([...(existing.source_session_ids ?? []), ...(incoming.source_session_ids ?? [])])],
    source_turn_ids: [...new Set([...(existing.source_turn_ids ?? []), ...(incoming.source_turn_ids ?? [])])],
    activity_evidence_ids: [...new Set([...(existing.activity_evidence_ids ?? []), ...(incoming.activity_evidence_ids ?? [])])],
    primary_trust_class: "repeated_user_preference",
    source_trust_weight: 0.9,
  };
  const existingIndex = rows.findIndex((candidate) =>
    candidate.id === existing.id
    && candidate.created_at === existing.created_at
    && candidate.status === existing.status
  );
  if (existingIndex >= 0) rows[existingIndex] = updated;
  replaceCandidates(root, rows);
  return { action: "reinforced", candidate: updated };
}
