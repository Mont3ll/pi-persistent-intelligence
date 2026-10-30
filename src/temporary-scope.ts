/**
 * Explicit constraints limiting a turn to the current test, task, or one-off
 * exercise. These constraints outrank otherwise durable-sounding language.
 *
 * Use this shared, source-text-only check for both capture classification and
 * memory-worth scoring; an evidence count or capture score cannot override it.
 * A rule ABOUT testing (e.g. "always run tests") is not inherently temporary.
 */
export function hasExplicitTaskOnlyScope(text: string): boolean {
  return /\b(?:for|in|during)\s+(?:this|the|current)\s+(?:(?:single|one)\s+)?(?:test(?:\s+run)?|run|task|trial|fixture|exercise|verification|audit|session|experiment|review)\s+only\b/i.test(text)
    || /\b(?:just|only)\s+(?:for|during)\s+(?:this|the|current)\s+(?:test(?:\s+run)?|run|task|trial|fixture|exercise|verification|audit|session|experiment|review)\b/i.test(text)
    || /\b(?:this|that|it)\s+(?:is|was|remains)\s+(?:(?:just|only|merely)\s+)?(?:an?\s+)?(?:one[- ]off|one[- ]time|test[- ]only|temporary)(?:\s+(?:instruction|request|rule|change|exception|requirement|directive|task))?\b/i.test(text)
    || /\b(?:one[- ]off|one[- ]time|single[- ]use|test[- ]only)\s+(?:instruction|request|rule|change|exception|requirement|directive)\b/i.test(text);
}
