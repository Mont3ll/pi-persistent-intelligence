/**
 * Injection filter — determines whether memory context should be injected
 * for a given prompt. Adapted from pi-code-intelligence's shouldRetrievePlanningContext.
 *
 * We inject for most prompts (unlike code retrieval which is expensive).
 * Only skip truly trivial acknowledgements where memory adds no value.
 */

const TRIVIAL_PROMPT = /^(?:ok|okay|yes|no|sure|right|correct|exactly|true|false|thanks|thank\s+you|sounds\s+good|looks\s+good|got\s+it|done|continue|proceed|go\s+on|next|great|perfect|nice|cool|yep|nope|understood|makes?\s+sense|agreed)\b\.?$/i;

const MIN_LENGTH = 4;

/**
 * Returns true if the prompt is substantive enough to warrant memory injection.
 * Slash commands, trivial acknowledgements, and very short inputs are skipped.
 */
export function shouldInjectMemoryContext(prompt: string): boolean {
  const text = prompt.trim();
  if (!text || text.length < MIN_LENGTH) return false;
  if (text.startsWith("/")) return false; // slash commands (e.g. /curate-memory)
  if (TRIVIAL_PROMPT.test(text)) return false;
  return true;
}

/**
 * Returns true if the prompt is substantial enough to warrant session history injection.
 * More restrictive than memory injection — sessions are noisier context.
 */
const SESSION_TRIGGER = /\b(implement|add|create|change|modify|update|refactor|fix|debug|review|how|what|why|explain|build|write|design|analyse|analyze|test|investigate|research|summarize|plan)\b/i;

export function shouldInjectSessionContext(prompt: string): boolean {
  if (!shouldInjectMemoryContext(prompt)) return false;
  return SESSION_TRIGGER.test(prompt) || prompt.length > 40;
}
