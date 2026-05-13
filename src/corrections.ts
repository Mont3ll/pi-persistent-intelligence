/**
 * Automatic correction signal detection.
 *
 * Adapted from pi-code-intelligence's detectCorrection.ts pattern.
 * Scans user message text for durable guidance/correction signals
 * and auto-adds them as inbox candidates without requiring explicit
 * memory_write tool calls.
 *
 * Confidence tiers:
 *   ≥ 0.85 → auto-eligible (will be auto-applied by tiered curation)
 *   0.65–0.84 → held for /curate-memory review
 *   < 0.65 → ignored
 */

import type { CaptureCandidate, MemoryRuleType } from "./types";

// ─── Detection patterns ───────────────────────────────────────────────────────

const CORRECTION_PATTERNS = [
  /\bdon['']?t\s+use\b/i,
  /\bdo\s+not\s+use\b/i,
  /\bstop\s+using\b/i,
  /\bwe\s+don['']?t\s+use\b/i,
  /\bwe\s+do\s+not\s+use\b/i,
  /\buse\s+.+\s+instead\b/i,
  /\buse\s+.+\s+instead\s+of\b/i,
  /\bprefer\s+.+\s+(?:over|to|instead\s+of)\b/i,
  /\bfavor\s+.+\s+(?:over|instead\s+of)\b/i,
  /\bavoid\s+.+\s+(?:use|prefer|in\s+favor\s+of)\b/i,
  /\blet['']?s\s+(?:ensure|make\s+sure)\s+(?:we\s+)?(?:always\s+)?use\b/i,
  /\bwe\s+should\s+(?:always\s+)?use\b/i,
  /\b(?:please\s+)?(?:always|never)\s+(?:use|prefer|add|run|write|put|check|validate|call|name|import|export|avoid|edit|modify|change|update)\b/i,
  /\b(?:make\s+sure|ensure)\s+(?:we\s+)?(?:always\s+)?(?:use|write|add|include|check|validate)\b/i,
  /\bnot\s+the\s+(?:right\s+)?pattern\b/i,
  /\bthat['']?s\s+wrong\b/i,
  /\bthis\s+(?:project|repo|codebase)\s+uses\b/i,
  /\bdon['']?t\s+edit\b/i,
  /\bnever\s+modify\b/i,
];

// Phrases that look like corrections but are conversational filler
const CONVERSATIONAL_EXCLUSIONS = [
  /^(?:ok|okay|yes|no|sure|thanks|thank you|sounds good|looks good|never mind|for now)\.?$/i,
  /\b(?:let's|lets|can we|could we|why is|what else|is there|seems logical|never mind|for now)\b/i,
  /\b(?:message to you|your message|without any context)\b/i,
];

const MIN_LENGTH = 10;

export function maybeCorrectionSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < MIN_LENGTH) return false;
  if (trimmed.startsWith("/")) return false; // slash commands
  if (CONVERSATIONAL_EXCLUSIONS.some((p) => p.test(trimmed))) return false;
  return CORRECTION_PATTERNS.some((p) => p.test(trimmed));
}

export function correctionConfidence(text: string): number {
  const lower = text.trim().toLowerCase();
  // Strong signals: explicit "always", "never", "do not", "prefer X over Y"
  if (/\b(always|never|do not|don't|this (?:project|repo|codebase) uses|prefer .+ (?:over|to|instead of)|favor .+ over|use .+ instead)\b/.test(lower)) {
    return /\bhere\b/.test(lower) ? 0.82 : 0.90;
  }
  // Medium signals: "we should", "make sure", "ensure"
  if (/\b(we should|make sure|ensure)\b/.test(lower)) return 0.72;
  // Weak signals
  if (/\bshould\b|\bnot the pattern\b|\bwrong\b/.test(lower)) return 0.60;
  return 0.50;
}

/**
 * Build a CaptureCandidate from a correction signal.
 * Returns null if confidence is too low to be worth storing.
 */
export function extractCorrectionCandidate(
  text: string,
  today: string,
  cwd: string,
  MIN_CONFIDENCE = 0.65,
): CaptureCandidate | null {
  const confidence = correctionConfidence(text);
  if (confidence < MIN_CONFIDENCE) return null;

  const statement = text.trim().slice(0, 300).replace(/\s+/g, " ");

  // Infer ruleType from the correction pattern for better retrieval and injection
  const lower = statement.toLowerCase();
  const ruleType: MemoryRuleType =
    /\b(don['\u2019]?t|do not|never|avoid|stop)\s+use\b/.test(lower) ? "avoid_pattern" :
    /\b(prefer|favor|use .+ instead|instead of)\b/.test(lower)       ? "prefer_pattern" :
    /\bthis\s+(project|repo|codebase)\s+uses\b/.test(lower)          ? "convention" :
    /\b(always|never)\b/.test(lower) && /\b(use|write|add|run|edit|modify)\b/.test(lower) ? "convention" :
    "correction";

  return {
    id: `cap_corr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    created_at: new Date().toISOString(),
    source: { type: "user_correction", ref: `daily/${today}.md`, cwd },
    text: statement,
    tags: ["correction", ruleType],
    evidence_refs: [`daily/${today}.md`],
    confidence,
    status: "new",
    ruleType,
  };
}
