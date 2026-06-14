import { scanSecrets } from "./secret-scanner";
import type { MemoryWorthDecision } from "./types";

export interface MemoryWorthSignals {
  user_explicitness?: number;
  recurrence?: number;
  correction_strength?: number;
  operational_impact?: number;
  future_reuse_likelihood?: number;
  specificity?: number;
  scope_clarity?: number;
  evidence_strength?: number;
  sensitivity_risk?: number;
  volatility?: number;
}

export interface MemoryWorthScore {
  worth_score: number;
  decision: MemoryWorthDecision;
  reasons: string[];
  signals: MemoryWorthSignals;
}

export interface MemoryWorthInput {
  observation: string;
  explicitUserRequest?: boolean;
  recurrenceCount?: number;
  operationalImpact?: number;
  evidenceStrength?: number;
  durability?: "temporary" | "task" | "project" | "long_term" | "unknown";
  scope?: string;
  existingStatements?: string[];
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
function tokenize(value: string): string[] { return value.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2); }
function similarity(a: string, b: string): number {
  const as = new Set(tokenize(a)); const bs = new Set(tokenize(b));
  if (as.size === 0 || bs.size === 0) return 0;
  const overlap = [...as].filter((t) => bs.has(t)).length;
  return overlap / Math.max(as.size, bs.size);
}

export function scoreMemoryWorth(input: MemoryWorthInput): MemoryWorthScore {
  const observation = input.observation.trim();
  const lower = observation.toLowerCase();
  const reasons: string[] = [];
  const explicit = input.explicitUserRequest || /\b(always|never|going forward|from now on|remember|do not|don't|prefer|use .* instead)\b/.test(lower);
  const correction = /\b(do not|don't|instead|prefer|never|correction|wrong|going forward|from now on)\b/.test(lower) ? 0.9 : explicit ? 0.55 : 0;
  const tokens = tokenize(observation);
  const trivial = tokens.length < 3 || /^(ok|okay|thanks|thank you|yes|no|done)[.! ]*$/i.test(observation);
  const duplicate = (input.existingStatements ?? []).some((s) => similarity(observation, s) >= 0.82);
  const secretScan = scanSecrets(observation);
  const sensitivity = secretScan.hasHighConfidenceSecret ? 1 : secretScan.findings.length ? 0.6 : 0;
  const temporary = input.durability === "temporary" || /\b(today|right now|temporary|for now|waiting for|this session)\b/.test(lower);
  const ambiguousLanguage = /\b(unclear|something|stuff|maybe|probably|unspecified|not sure)\b/.test(lower);
  const vague = (tokens.length < 5 && !explicit) || ambiguousLanguage;

  const signals: MemoryWorthSignals = {
    user_explicitness: explicit ? 1 : 0,
    recurrence: clamp((input.recurrenceCount ?? 0) / 3),
    correction_strength: correction,
    operational_impact: clamp(input.operationalImpact ?? (/\b(test|typecheck|deploy|deployment|release|publish|critical|security|secret|commit|push)\b/.test(lower) ? 0.8 : 0.25)),
    future_reuse_likelihood: temporary ? 0.2 : explicit ? 0.85 : 0.45,
    specificity: clamp(tokens.length / 14),
    scope_clarity: input.scope || /\b(project|repo|global|this project|workspace|user)\b/.test(lower) ? 0.8 : 0.25,
    evidence_strength: clamp(input.evidenceStrength ?? (explicit ? 0.75 : 0.25)),
    sensitivity_risk: sensitivity,
    volatility: temporary ? 0.9 : 0.25,
  };

  if (trivial) reasons.push("trivial_or_low_information");
  if (duplicate) reasons.push("already_represented");
  if (sensitivity > 0.8 && !input.explicitUserRequest) reasons.push("sensitive_without_explicit_request");
  if (temporary) reasons.push("temporary_or_ephemeral");
  if (vague) reasons.push("underspecified");

  const worth = clamp(
    (signals.user_explicitness ?? 0) * 0.18 +
    (signals.recurrence ?? 0) * 0.16 +
    (signals.correction_strength ?? 0) * 0.18 +
    (signals.operational_impact ?? 0) * 0.14 +
    (signals.future_reuse_likelihood ?? 0) * 0.12 +
    (signals.specificity ?? 0) * 0.08 +
    (signals.scope_clarity ?? 0) * 0.07 +
    (signals.evidence_strength ?? 0) * 0.07 -
    (signals.sensitivity_risk ?? 0) * 0.25 -
    (signals.volatility ?? 0) * 0.12,
  );

  let decision: MemoryWorthDecision;
  if (trivial || duplicate || (sensitivity > 0.8 && !input.explicitUserRequest)) decision = "reject";
  else if (temporary && worth < 0.62) decision = "daily_only";
  else if (!explicit && (signals.operational_impact ?? 0) >= 0.8 && (vague || (signals.scope_clarity ?? 0) < 0.5)) {
    decision = "inquiry";
    reasons.push("important_but_underspecified");
  } else if (worth >= 0.58 || correction >= 0.8 || (explicit && worth >= 0.5) || ((signals.operational_impact ?? 0) >= 0.8 && (signals.evidence_strength ?? 0) >= 0.7 && !vague) || (signals.recurrence ?? 0) >= 0.66) decision = "candidate";
  else if (worth >= 0.35) decision = "daily_only";
  else decision = "reject";

  return { worth_score: Number(worth.toFixed(3)), decision, reasons, signals };
}
