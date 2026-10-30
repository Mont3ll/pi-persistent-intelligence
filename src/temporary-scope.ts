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
// The unit must end at a clause boundary. Phrases like "only within the
// current trial results" or "the current test suite" name documents/suites,
// not necessarily a one-off runtime scope.
// A bounded limiter may introduce its *purpose* without extending its lifetime.
// These continuations are explicit clause transitions, not arbitrary words
// following "test"/"trial" (e.g. "test suite" or "trial results").
const scopeEnd = String.raw`(?=$|[.,;:!?)]|\s+(?:(?:and|but|because|if|unless|when|while|after|before|then|to)\b|in\s+order\s+to\b|so\s+that\b|so\s+(?:we|i)\s+can\b))`;
const trailingOnly = new RegExp(String.raw`\b${preposition}\s+${unit}\s+only\b${scopeEnd}`, "i");
const leadingOnly = new RegExp(String.raw`\b(?:just|only)\s+${preposition}\s+${unit}\b${scopeEnd}`, "i");
// Explicit finite-lifetime clauses convey task scope even without "only".
// Require a bounded, current task period and an endpoint; mere mentions of
// test results, suites or an ongoing permanent testing workflow are not enough.
// Duration modifiers express the same finite lifetime; keep them scoped to
// a named current task period to avoid matching generic release policies.
const forDuration = new RegExp(String.raw`\bfor\s+(?:the\s+)?(?:(?:full|entire|whole|remaining)\s+)?duration\s+of\s+${unit}\b${scopeEnd}`, "i");
// Perfect-aspect endings refer to the same expiry event as "ends".
const expiry = String.raw`(?:ends?|finishes?|concludes?|expires?|is\s+over|has\s+(?:ended|finished|concluded|expired)|is\s+(?:finished|complete|completed))`;
const untilEnds = new RegExp(String.raw`\buntil\s+${unit}\s+${expiry}\b${scopeEnd}`, "i");
const untilEndOf = new RegExp(String.raw`\buntil\s+the\s+end\s+of\s+${unit}\b${scopeEnd}`, "i");

export function hasExplicitTaskOnlyScope(text: string): boolean {
  return trailingOnly.test(text)
    || leadingOnly.test(text)
    || forDuration.test(text)
    || untilEnds.test(text)
    || untilEndOf.test(text)
    || /\b(?:this|that|it)\s+(?:is|was|remains)\s+(?:(?:just|only|merely)\s+)?(?:an?\s+)?(?:one[- ]off|one[- ]time|test[- ]only|temporary)(?:\s+(?:instruction|request|rule|change|exception|requirement|directive|task))?\b/i.test(text)
    || /\b(?:one[- ]off|one[- ]time|single[- ]use|test[- ]only)\s+(?:instruction|request|rule|change|exception|requirement|directive)\b/i.test(text);
}
