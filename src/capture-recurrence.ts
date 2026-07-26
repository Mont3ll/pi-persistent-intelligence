import { listCandidates, replaceCandidates } from "./inbox";
import type { CaptureCandidate, CaptureIntent, CaptureScopeTarget } from "./types";

function canonicalScopes(scopes: CaptureScopeTarget[] | undefined): string {
  return JSON.stringify((scopes ?? []).map((scope) => ({ type: scope.type, project: scope.project, domain: scope.domain }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

export function normalizedPreferenceKey(text: string, intent: CaptureIntent): string {
  const normalized = text.toLowerCase()
    .replace(/em[ -]?dashes?/g, "em dash")
    .replace(/en[ -]?dashes?/g, "en dash")
    .replace(/\b(?:please|always|never|avoid|avoiding|do not|don't|use|prefer|my preference is|i prefer|when writing for me|for all my writing)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return `${intent}:${normalized}`;
}

export function findEquivalentCandidate(root: string, key: string, scopes: CaptureScopeTarget[] | undefined): CaptureCandidate | null {
  const expectedScopes = canonicalScopes(scopes);
  return listCandidates(root).find((candidate) =>
    candidate.status === "new"
    && candidate.normalized_preference_key === key
    && canonicalScopes(candidate.scope_targets) === expectedScopes
  ) ?? null;
}

export function appendOrReinforceCandidate(root: string, incoming: CaptureCandidate): { action: "created" | "reinforced"; candidate: CaptureCandidate } {
  const key = incoming.normalized_preference_key ?? normalizedPreferenceKey(incoming.text, incoming.capture_intent ?? "behavior_correction");
  const existing = findEquivalentCandidate(root, key, incoming.scope_targets);
  if (!existing) {
    const candidate = { ...incoming, normalized_preference_key: key, recurrence_count: incoming.recurrence_count ?? 1 };
    const rows = listCandidates(root);
    rows.push(candidate);
    replaceCandidates(root, rows);
    return { action: "created", candidate };
  }

  const updated: CaptureCandidate = {
    ...existing,
    recurrence_count: (existing.recurrence_count ?? 1) + 1,
    evidence_refs: [...new Set([...existing.evidence_refs, ...incoming.evidence_refs])],
    evidence_ids: [...new Set([...(existing.evidence_ids ?? []), ...(incoming.evidence_ids ?? [])])],
    source_session_ids: [...new Set([...(existing.source_session_ids ?? []), ...(incoming.source_session_ids ?? [])])],
    source_turn_ids: [...new Set([...(existing.source_turn_ids ?? []), ...(incoming.source_turn_ids ?? [])])],
    activity_evidence_ids: [...new Set([...(existing.activity_evidence_ids ?? []), ...(incoming.activity_evidence_ids ?? [])])],
    primary_trust_class: "repeated_user_preference",
    source_trust_weight: 0.9,
  };
  replaceCandidates(root, listCandidates(root).map((candidate) => candidate.id === existing.id ? updated : candidate));
  return { action: "reinforced", candidate: updated };
}
