/**
 * Explicit constraints limiting a turn to the current test, task, or one-off
 * exercise. These constraints outrank otherwise durable-sounding language.
 *
 * Use this shared, source-text-only check for both capture classification and
 * memory-worth scoring; an evidence count or capture score cannot override it.
 * A rule ABOUT testing (e.g. "always run tests") is not inherently temporary.
 * Parse determiner + modifier together: "the current test" cannot be
 * recognized by a mutually exclusive "the" versus "current" alternative.
 */
// Both positions of "only" must use exactly the same bounded grammar.
// Keep the determiners, optional modifiers, prepositions and time units in
// shared fragments so a new phrase cannot be handled in only one position.
// "within" is a temporal limiter in the same bounded task scope, not a
// general-purpose project applicability cue.
const taskPeriod = String.raw`(?:test(?:\s+run)?|run|task|trial|fixture|exercise|verification|audit|session|experiment|review)`;
const determiner = String.raw`(?:(?:this|the)(?:\s+current)?|current)`;
const unit = String.raw`${determiner}\s+(?:(?:single|one)\s+)?${taskPeriod}`;
const preposition = String.raw`(?:for|in|during|within)`;
const trailingOnly = new RegExp(String.raw`\b${preposition}\s+${unit}\s+only\b`, "i");
const leadingOnly = new RegExp(String.raw`\b(?:just|only)\s+${preposition}\s+${unit}\b`, "i");

export function hasExplicitTaskOnlyScope(text: string): boolean {
  return trailingOnly.test(text)
    || leadingOnly.test(text)
    || /\b(?:this|that|it)\s+(?:is|was|remains)\s+(?:(?:just|only|merely)\s+)?(?:an?\s+)?(?:one[- ]off|one[- ]time|test[- ]only|temporary)(?:\s+(?:instruction|request|rule|change|exception|requirement|directive|task))?\b/i.test(text)
    || /\b(?:one[- ]off|one[- ]time|single[- ]use|test[- ]only)\s+(?:instruction|request|rule|change|exception|requirement|directive)\b/i.test(text);
}
