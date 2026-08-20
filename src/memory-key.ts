import type { CaptureCandidate, MemoryKeyParts, MemoryRecord, MemoryRuleType, NormalizedMemoryKey } from "./types";

const GENERIC_TAGS = new Set([
  "workflow",
  "preference",
  "convention",
  "architecture",
  "avoid_pattern",
  "prefer_pattern",
  "testing",
  "correction",
  "tool",
  "supersede",
  "supersedes",
]);

const CAPTURE_PROVENANCE_TAGS = new Set([
  "capture",
  "capture-backfill",
  "legacy-evidence-backfill",
]);

const CAPTURE_INTENT_TAGS = new Set([
  "user_preference",
  "behavior_correction",
  "project_convention",
  "workflow_playbook",
  "temporary_instruction",
  "not_memory",
]);

const LIFECYCLE_TAGS = new Set([
  "active",
  "contested",
  "deprecated",
  "deleted",
  "rejected",
  "review-required",
  "superseded",
  "tombstone",
  "tombstoned",
]);

const APPLICABILITY_TAGS = new Set([
  "writing",
  "documentation",
  "release",
  "testing",
  "implementation",
]);

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "should", "always", "never", "use", "uses", "using", "instead", "rather", "than", "not", "don", "dont", "do", "does", "source", "truth", "as", "of", "to", "in", "on", "a", "an", "i", "me", "my", "when", "entirely",
]);

export function normalizeMemoryKeyInput(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

/** Legacy five-component key helper retained for explicit v1 compatibility. */
export function createMemoryKey(parts: MemoryKeyParts): NormalizedMemoryKey {
  return [
    normalizeMemoryKeyInput(parts.profile_id || "legacy"),
    normalizeMemoryKeyInput(parts.scope_level || "global"),
    normalizeMemoryKeyInput(parts.scope_ref || "global"),
    normalizeMemoryKeyInput(parts.topic || "general"),
    normalizeMemoryKeyInput(parts.ruleType ?? "memory"),
  ].join("|");
}

export function createMemoryKeyV2(parts: MemoryKeyParts): NormalizedMemoryKey {
  return [
    "v2",
    normalizeMemoryKeyInput(parts.profile_id || "legacy"),
    normalizeMemoryKeyInput(parts.scope_level || "global"),
    normalizeMemoryKeyInput(parts.scope_ref || "global"),
    normalizeMemoryKeyInput(parts.topic || "general"),
    normalizeMemoryKeyInput(parts.ruleType ?? "memory"),
  ].join("|");
}

function normalizedTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function isExcludedTopicTag(tag: string): boolean {
  const value = normalizedTag(tag);
  return !value
    || value.startsWith("supersedes:")
    || GENERIC_TAGS.has(value)
    || CAPTURE_PROVENANCE_TAGS.has(value)
    || CAPTURE_INTENT_TAGS.has(value)
    || LIFECYCLE_TAGS.has(value)
    || APPLICABILITY_TAGS.has(value);
}

function topicFromStatement(statement: string): string {
  const normalized = statement
    .toLowerCase()
    .replace(/em[ -]?dashes?/g, "em dash")
    .replace(/en[ -]?dashes?/g, "en dash")
    .replace(/\b(?:when writing for me|for all my writing|my preference is|i prefer|never use|always use|do not|don't|avoid(?:ing)?|prefer)\b/g, " ");
  const tokens = normalized
    .split(/[^a-z0-9]+/)
    .filter((token) => (token.length > 2 || token === "em" || token === "en") && !STOPWORDS.has(token));
  return tokens.slice(0, 6).join("-") || "general";
}

/** Reproduces v1 tag-first topic inference for bounded compatibility checks. */
export function inferLegacyMemoryTopic(input: { tags?: string[]; statement: string }): string {
  const tag = (input.tags ?? [])
    .map((item) => item.replace(/^supersedes:.+$/, ""))
    .find((item) => item && !GENERIC_TAGS.has(item));
  return normalizeMemoryKeyInput(tag ?? topicFromStatement(input.statement));
}

export function inferMemoryTopic(input: { tags?: string[]; statement: string }): string {
  const tag = (input.tags ?? []).find((item) => !isExcludedTopicTag(item));
  return normalizeMemoryKeyInput(tag ?? topicFromStatement(input.statement));
}

function scopeParts(scope: MemoryRecord["scope"] | undefined): { scope_level: string; scope_ref: string } {
  if (!scope) return { scope_level: "global", scope_ref: "global" };
  if (scope.type === "project") return { scope_level: "project", scope_ref: scope.project ?? "project" };
  if (scope.type === "domain") {
    const domains = [...new Set((scope.domains ?? []).map(normalizeMemoryKeyInput))].sort();
    return { scope_level: "domain", scope_ref: domains.join("+") || "domain" };
  }
  return { scope_level: "global", scope_ref: "global" };
}

export function getRecordMemoryKey(record: MemoryRecord): NormalizedMemoryKey {
  if (record.normalized_key) return record.normalized_key;
  const scope = scopeParts(record.scope);
  return createMemoryKeyV2({
    profile_id: record.profile_id ?? "legacy",
    scope_level: scope.scope_level,
    scope_ref: scope.scope_ref,
    topic: inferMemoryTopic({ tags: record.tags, statement: record.statement }),
    ruleType: record.ruleType,
  });
}

export function getDerivedRecordMemoryKeyV2(record: MemoryRecord): NormalizedMemoryKey {
  const scope = scopeParts(record.scope);
  return createMemoryKeyV2({
    profile_id: record.profile_id ?? "legacy",
    scope_level: scope.scope_level,
    scope_ref: scope.scope_ref,
    topic: inferMemoryTopic({ tags: record.tags, statement: record.statement }),
    ruleType: record.ruleType,
  });
}

function structuralV1Topic(key: string): string | null {
  const parts = key.split("|");
  return parts.length === 5 ? parts[3] : null;
}

export function isExcludedLegacyMemoryKey(key: string): boolean {
  const topic = structuralV1Topic(key);
  return topic !== null && isExcludedTopicTag(topic);
}

export function getRecordMemoryKeys(record: MemoryRecord): NormalizedMemoryKey[] {
  if (!record.normalized_key) return [getDerivedRecordMemoryKeyV2(record)];
  const topic = structuralV1Topic(record.normalized_key);
  if (topic === null) return [record.normalized_key];
  const derived = getDerivedRecordMemoryKeyV2(record);
  return isExcludedTopicTag(topic)
    ? [derived]
    : [...new Set([record.normalized_key, derived])];
}

export function memoryIdFromCandidateId(candidateId: string): string {
  if (candidateId.startsWith("cap_")) return `mem_${candidateId.slice(4)}`;
  if (candidateId === "cap") return "mem";
  return candidateId.replace(/^cap/, "mem");
}

function candidateScope(candidate: CaptureCandidate, fallbackScope?: MemoryRecord["scope"]): MemoryRecord["scope"] {
  if (fallbackScope) return fallbackScope;
  const target = candidate.scope_targets?.length === 1 ? candidate.scope_targets[0] : undefined;
  if (target?.type === "project") return { type: "project", project: target.project };
  if (target?.type === "domain") return { type: "domain", domains: target.domain ? [target.domain] : [] };
  if (target?.type === "global") return { type: "global" };
  return candidate.source.cwd
    ? { type: "project", project: candidate.source.cwd.split(/[\\/]/).filter(Boolean).at(-1) }
    : { type: "global" };
}

function getDerivedCandidateMemoryKeyV2(candidate: CaptureCandidate, fallbackScope?: MemoryRecord["scope"]): NormalizedMemoryKey {
  const scope = scopeParts(candidateScope(candidate, fallbackScope));
  return createMemoryKeyV2({
    profile_id: candidate.profile_id ?? "legacy",
    scope_level: scope.scope_level,
    scope_ref: scope.scope_ref,
    topic: inferMemoryTopic({ tags: candidate.tags, statement: candidate.text }),
    ruleType: candidate.ruleType as MemoryRuleType | undefined,
  });
}

export function getCandidateMemoryKey(candidate: CaptureCandidate, fallbackScope?: MemoryRecord["scope"]): NormalizedMemoryKey {
  return candidate.normalized_key ?? getDerivedCandidateMemoryKeyV2(candidate, fallbackScope);
}

export function getCandidateMemoryKeys(candidate: CaptureCandidate, fallbackScope?: MemoryRecord["scope"]): NormalizedMemoryKey[] {
  if (!candidate.normalized_key) return [getDerivedCandidateMemoryKeyV2(candidate, fallbackScope)];
  const topic = structuralV1Topic(candidate.normalized_key);
  if (topic === null) return [candidate.normalized_key];
  const derived = getDerivedCandidateMemoryKeyV2(candidate, fallbackScope);
  return isExcludedTopicTag(topic)
    ? [derived]
    : [...new Set([candidate.normalized_key, derived])];
}
