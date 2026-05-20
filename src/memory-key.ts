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

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "should", "always", "never", "use", "uses", "using", "instead", "rather", "than", "not", "don", "dont", "do", "does", "source", "truth", "as", "of", "to", "in", "on", "a", "an",
]);

export function normalizeMemoryKeyInput(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

export function createMemoryKey(parts: MemoryKeyParts): NormalizedMemoryKey {
  return [
    normalizeMemoryKeyInput(parts.profile_id || "legacy"),
    normalizeMemoryKeyInput(parts.scope_level || "global"),
    normalizeMemoryKeyInput(parts.scope_ref || "global"),
    normalizeMemoryKeyInput(parts.topic || "general"),
    normalizeMemoryKeyInput(parts.ruleType ?? "memory"),
  ].join("|");
}

function topicFromStatement(statement: string): string {
  const tokens = statement
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
  return tokens.slice(0, 5).join("-") || "general";
}

export function inferMemoryTopic(input: { tags?: string[]; statement: string }): string {
  const tag = (input.tags ?? [])
    .map((item) => item.replace(/^supersedes:.+$/, ""))
    .find((item) => item && !GENERIC_TAGS.has(item));
  return normalizeMemoryKeyInput(tag ?? topicFromStatement(input.statement));
}

function scopeParts(scope: MemoryRecord["scope"] | undefined): { scope_level: string; scope_ref: string } {
  if (!scope) return { scope_level: "global", scope_ref: "global" };
  if (scope.type === "project") return { scope_level: "project", scope_ref: scope.project ?? "project" };
  if (scope.type === "domain") return { scope_level: "domain", scope_ref: scope.domains?.join("+") || "domain" };
  return { scope_level: "global", scope_ref: "global" };
}

export function getRecordMemoryKey(record: MemoryRecord): NormalizedMemoryKey {
  if (record.normalized_key) return record.normalized_key;
  const scope = scopeParts(record.scope);
  return createMemoryKey({
    profile_id: record.profile_id ?? "legacy",
    scope_level: scope.scope_level,
    scope_ref: scope.scope_ref,
    topic: inferMemoryTopic({ tags: record.tags, statement: record.statement }),
    ruleType: record.ruleType,
  });
}

export function memoryIdFromCandidateId(candidateId: string): string {
  if (candidateId.startsWith("cap_")) return `mem_${candidateId.slice(4)}`;
  if (candidateId === "cap") return "mem";
  return candidateId.replace(/^cap/, "mem");
}

export function getCandidateMemoryKey(candidate: CaptureCandidate, fallbackScope?: MemoryRecord["scope"]): NormalizedMemoryKey {
  if (candidate.normalized_key) return candidate.normalized_key;
  const scope = scopeParts(fallbackScope ?? (candidate.source.cwd ? { type: "project", project: candidate.source.cwd.split(/[\\/]/).filter(Boolean).at(-1) } : { type: "global" }));
  return createMemoryKey({
    profile_id: candidate.profile_id ?? "legacy",
    scope_level: scope.scope_level,
    scope_ref: scope.scope_ref,
    topic: inferMemoryTopic({ tags: candidate.tags, statement: candidate.text }),
    ruleType: candidate.ruleType as MemoryRuleType | undefined,
  });
}
