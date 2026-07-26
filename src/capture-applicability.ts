import type { DomainTag, MemoryRecord, SessionContext } from "./types";

export type TaskCategory = "writing" | "documentation" | "release" | "testing" | "implementation" | "research";

export function detectTaskCategories(prompt: string, recentFiles: string[]): DomainTag[] {
  const text = `${prompt} ${recentFiles.join(" ")}`.toLowerCase();
  const categories: DomainTag[] = [];
  if (/\b(write|writing|rewrite|edit(?:ing)? copy|linkedin|portfolio|profile|application|article|blog|punctuation|heading|humanize|humanizer)\b/.test(text)) categories.push("writing");
  if (/\b(documentation|docs|readme|changelog|wiki|markdown)\b/.test(text)) categories.push("documentation");
  if (/\b(release|publish|package|registry|tag)\b/.test(text)) categories.push("release");
  if (/\b(test|testing|typecheck|lint|clippy|rustfmt|cargo check|vitest|playwright)\b/.test(text)) categories.push("testing");
  if (/\b(implement|code|debug|fix|refactor|repository|repo|crate|module)\b/.test(text)) categories.push("implementation");
  if (/\b(research|paper|source|literature|evidence)\b/.test(text)) categories.push("research");
  return [...new Set(categories)];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function matchesPositiveApplicability(record: MemoryRecord, context: SessionContext): boolean {
  if (!record.applies_when?.length) return true;
  const text = normalize([
    context.latest_user_message,
    context.first_user_message,
    context.task_intent,
    ...(context.recent_files_touched ?? []),
    ...context.detected_domain_tags,
  ].filter(Boolean).join(" "));
  return record.applies_when.some((condition) => {
    const expected = normalize(condition);
    if (!expected) return false;
    if (text.includes(expected)) return true;
    return expected.split(" ").some((token) => token.length > 3 && text.split(" ").some((actual) => actual.startsWith(token) || token.startsWith(actual)));
  });
}
