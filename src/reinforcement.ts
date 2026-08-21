import { createHash } from "node:crypto";
import { appendJsonl, readJsonl } from "./jsonl";
import { ensureMemoryDirs } from "./paths";
import { loadAllRecords } from "./store";
import type { MemoryRecord, ReinforcementEvent, ReinforcementOutcome, ReinforcementSummary, Stability } from "./types";

export type RecordedToolOutcome = "success" | "failure" | "unknown";

export function classifyRecordedToolOutcome(value: Record<string, unknown>): RecordedToolOutcome {
  if (value.success === false || value.ok === false || value.passed === false || value.isError === true) return "failure";
  const exitCode = value.exitCode ?? value.exit_code ?? value.code;
  if (typeof exitCode === "number") return exitCode === 0 ? "success" : "failure";
  if (value.success === true || value.ok === true || value.passed === true) return "success";
  const status = typeof value.status === "string" ? value.status.toLowerCase() : "";
  if (["passed", "success", "succeeded", "ok", "completed"].includes(status)) return "success";
  if (["failed", "failure", "error"].includes(status)) return "failure";
  return "unknown";
}

export type ReinforcementCommandClass = "test" | "typecheck" | "lint" | "build" | "validation";

export interface ReinforcementLinkDecision {
  outcome: "implicit_success" | "neutral_exposure" | "none";
  memory_id?: string;
  reason: string;
  command_class?: ReinforcementCommandClass;
  attribution_score?: number;
  matched_signals?: string[];
}

export interface ReinforcementObservableOutcome {
  kind: "test" | "tool";
  success: boolean;
  tool_name?: string;
  command?: string;
}

export interface ReinforcementLinkInput {
  selected_memory: MemoryRecord[];
  session_id: string;
  observable_outcome?: ReinforcementObservableOutcome;
  neutral_exposure_enabled: boolean;
  existing_events?: ReinforcementEvent[];
}

const OUTCOME_WEIGHTS: Record<ReinforcementOutcome, number> = {
  explicit_reinforcement: 1.0,
  implicit_success: 0.2,
  neutral_exposure: 0,
  explicit_correction: -1.0,
};

export interface CreateReinforcementEventInput {
  resource_id?: string;
  profile_id?: string;
  thread_id?: string;
  memory_id: string;
  outcome: ReinforcementOutcome;
  evidence_id?: string;
  notes?: string;
  now?: string;
}

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 10);
}

export function createReinforcementEvent(input: CreateReinforcementEventInput): ReinforcementEvent {
  const timestamp = input.now ?? new Date().toISOString();
  return {
    id: `rein_${input.memory_id}_${hash(`${input.memory_id}\n${input.outcome}\n${timestamp}\n${input.notes ?? ""}`)}`,
    resource_id: input.resource_id,
    profile_id: input.profile_id,
    thread_id: input.thread_id,
    memory_id: input.memory_id,
    timestamp,
    outcome: input.outcome,
    evidence_id: input.evidence_id,
    notes: input.notes,
  };
}

export function appendReinforcementEvent(root: string, event: ReinforcementEvent): ReinforcementEvent {
  const paths = ensureMemoryDirs(root);
  appendJsonl(paths.memory.reinforcement, event);
  return event;
}

export function readReinforcementEvents(root: string): ReinforcementEvent[] {
  const paths = ensureMemoryDirs(root);
  return readJsonl<ReinforcementEvent>(paths.memory.reinforcement);
}

export function readReinforcementEventsForMemory(root: string, memoryId: string): ReinforcementEvent[] {
  return readReinforcementEvents(root).filter((event) => event.memory_id === memoryId);
}

const COMMAND_CLASS_ALIASES: Record<ReinforcementCommandClass, string[]> = {
  test: ["test", "spec", "vitest", "jest", "pytest", "playwright"],
  typecheck: ["typecheck", "typescript", "typing", "tsc"],
  lint: ["lint", "eslint", "clippy"],
  build: ["build", "compile", "bundle"],
  validation: ["validate", "validation", "verify", "verification", "check"],
};

const GENERIC_OPERATION_TERMS = new Set(["bash", "bun", "cargo", "command", "node", "npm", "npx", "pnpm", "run", "tool", "unit", "yarn"]);

function normalizeTerm(value: string): string {
  const term = value.toLowerCase();
  if (term === "tests" || term === "testing" || term === "tested") return "test";
  if (term === "builds" || term === "building" || term === "built") return "build";
  if (term === "checks" || term === "checking" || term === "checked") return "check";
  return term;
}

function semanticTerms(value: string): Set<string> {
  return new Set(value.split(/[^a-zA-Z0-9]+/).map(normalizeTerm).filter((term) => term.length >= 2));
}

export function classifyReinforcementCommand(outcome: ReinforcementObservableOutcome): ReinforcementCommandClass | null {
  const label = `${outcome.kind} ${outcome.tool_name ?? ""} ${outcome.command ?? ""}`.toLowerCase();
  if (outcome.kind === "test" || /\b(test|tests|testing|spec|vitest|jest|pytest|playwright)\b/.test(label)) return "test";
  if (/\b(typecheck|typescript|tsc)\b/.test(label) || /\bcargo\s+check\b/.test(label)) return "typecheck";
  if (/\b(lint|eslint|clippy)\b/.test(label)) return "lint";
  if (/\b(build|compile|bundle)\b/.test(label)) return "build";
  if (/\b(validate|validation|verify|verification|check)\b/.test(label)) return "validation";
  return null;
}

function attributionCandidate(memory: MemoryRecord, outcome: ReinforcementObservableOutcome, commandClass: ReinforcementCommandClass): { memory: MemoryRecord; score: number; signals: string[] } | null {
  const aliases = new Set(COMMAND_CLASS_ALIASES[commandClass]);
  const applicabilityTerms = semanticTerms((memory.applies_when ?? []).join(" "));
  const classTerms = semanticTerms(`${memory.statement} ${(memory.applies_when ?? []).join(" ")}`);
  const classAligned = [...aliases].some((term) => classTerms.has(term));
  if (!classAligned) return null;

  const operationTerms = semanticTerms(`${outcome.tool_name ?? ""} ${outcome.command ?? ""}`);
  const recordTerms = semanticTerms(`${memory.statement} ${memory.tags.join(" ")} ${(memory.applies_when ?? []).join(" ")}`);
  const contextualOperationTerms = new Set([...operationTerms].filter((term) => !aliases.has(term) && !GENERIC_OPERATION_TERMS.has(term)));
  const contextualRecordTerms = new Set([...recordTerms].filter((term) => !aliases.has(term) && !GENERIC_OPERATION_TERMS.has(term)));
  const matchedTerms = [...contextualRecordTerms].filter((term) => contextualOperationTerms.has(term));
  const applicabilityMatch = [...applicabilityTerms].some((term) => aliases.has(term) || operationTerms.has(term));
  const overlapScore = matchedTerms.length / Math.max(1, Math.min(contextualRecordTerms.size, contextualOperationTerms.size));
  const score = Math.round((1 + (applicabilityMatch ? 0.4 : 0) + Math.min(0.6, overlapScore * 0.6)) * 100) / 100;
  const signals = ["command_class", ...(applicabilityMatch ? ["applicability"] : []), ...(matchedTerms.length ? [`term_overlap:${matchedTerms.sort().join(",")}`] : [])];
  return { memory, score, signals };
}

export function decideReinforcementLink(input: ReinforcementLinkInput): ReinforcementLinkDecision {
  const active = input.selected_memory.filter((memory) => memory.status === "active");
  if (input.observable_outcome) {
    if (!input.observable_outcome.success) return { outcome: "none", reason: "observable_outcome_failed" };
    if (active.length === 0) return { outcome: "none", reason: "no_active_selected_memory" };
    const commandClass = classifyReinforcementCommand(input.observable_outcome);
    if (!commandClass) return { outcome: "none", reason: "unsupported_operation_class" };
    const candidates = active.flatMap((memory) => {
      const candidate = attributionCandidate(memory, input.observable_outcome!, commandClass);
      return candidate ? [candidate] : [];
    }).sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id));
    if (candidates.length === 0) return { outcome: "none", reason: "no_demonstrably_relevant_memory", command_class: commandClass };
    if (candidates.length > 1 && candidates[0].score - candidates[1].score < 0.2) return { outcome: "none", reason: "ambiguous_relevant_memories", command_class: commandClass };
    return {
      outcome: "implicit_success",
      memory_id: candidates[0].memory.id,
      reason: `deterministic_attribution_v1:${commandClass}`,
      command_class: commandClass,
      attribution_score: candidates[0].score,
      matched_signals: candidates[0].signals,
    };
  }
  if (!input.neutral_exposure_enabled) return { outcome: "none", reason: "neutral_exposure_disabled" };
  if (active.length !== 1) return { outcome: "none", reason: active.length === 0 ? "no_active_selected_memory" : "ambiguous_selected_memory" };
  const duplicate = (input.existing_events ?? []).some((event) => event.memory_id === active[0].id && event.outcome === "neutral_exposure" && event.thread_id === input.session_id);
  if (duplicate) return { outcome: "none", reason: "neutral_exposure_already_recorded_for_session" };
  return { outcome: "neutral_exposure", memory_id: active[0].id, reason: "bounded_selected_memory_exposure" };
}

export function captureReinforcementLink(root: string, input: ReinforcementLinkInput & { now?: string }): { decision: ReinforcementLinkDecision; event?: ReinforcementEvent } {
  const existing = input.existing_events ?? readReinforcementEvents(root);
  const decision = decideReinforcementLink({ ...input, existing_events: existing });
  if (decision.outcome === "none" || !decision.memory_id) return { decision };
  if (decision.outcome === "implicit_success" && existing.some((event) => event.memory_id === decision.memory_id && event.outcome === "implicit_success" && event.thread_id === input.session_id)) {
    return { decision: { outcome: "none", reason: "implicit_success_already_recorded_for_session", command_class: decision.command_class } };
  }
  const memory = input.selected_memory.find((record) => record.id === decision.memory_id)!;
  const attributionNotes = decision.outcome === "implicit_success"
    ? `deterministic_attribution_v1 class=${decision.command_class ?? "unknown"} score=${decision.attribution_score ?? 0} signals=${(decision.matched_signals ?? []).join("|")}`.slice(0, 300)
    : decision.reason;
  const event = createReinforcementEvent({
    resource_id: memory.resource_id,
    profile_id: memory.profile_id,
    thread_id: input.session_id,
    memory_id: decision.memory_id,
    outcome: decision.outcome,
    notes: attributionNotes,
    now: input.now,
  });
  appendReinforcementEvent(root, event);
  return { decision, event };
}

export function recordExplicitReinforcement(
  root: string,
  input: { memory_id: string; note: string; session_id: string; now?: string },
): { event: ReinforcementEvent; created: boolean } {
  const memory = loadAllRecords(root).find((record) => record.id === input.memory_id && record.status === "active");
  if (!memory) throw new Error(`Explicit reinforcement requires an active memory: ${input.memory_id}.`);
  const note = input.note.trim().replace(/\s+/g, " ").slice(0, 300);
  if (!note) throw new Error("Explicit reinforcement requires a non-empty --note.");
  const existing = readReinforcementEvents(root).find((event) =>
    event.memory_id === input.memory_id
    && event.outcome === "explicit_reinforcement"
    && event.thread_id === input.session_id
    && event.notes === note,
  );
  if (existing) return { event: existing, created: false };
  const event = createReinforcementEvent({
    resource_id: memory.resource_id,
    profile_id: memory.profile_id,
    thread_id: input.session_id,
    memory_id: memory.id,
    outcome: "explicit_reinforcement",
    notes: note,
    now: input.now,
  });
  appendReinforcementEvent(root, event);
  return { event, created: true };
}

function emptyCounts(): Record<ReinforcementOutcome, number> {
  return { explicit_reinforcement: 0, implicit_success: 0, neutral_exposure: 0, explicit_correction: 0 };
}

function suggestedStability(score: number, explicitCorrections: number): Stability {
  if (explicitCorrections > 0 || score < 0) return "low";
  if (score >= 1.0) return "stable";
  return "semi-stable";
}

export function summarizeReinforcement(events: ReinforcementEvent[]): ReinforcementSummary {
  const counts = emptyCounts();
  let score = 0;
  for (const event of events) {
    counts[event.outcome]++;
    score += OUTCOME_WEIGHTS[event.outcome];
  }
  score = Math.round(score * 100) / 100;
  const reasons: string[] = [];
  if (counts.explicit_correction > 0) reasons.push("Explicit correction outweighs implicit success and requires review.");
  if (counts.neutral_exposure > 0) reasons.push("Neutral exposure does not increase stability.");
  if (counts.implicit_success > 0) reasons.push("Implicit success is weak reinforcement only when the memory was exercised.");
  if (counts.explicit_reinforcement > 0) reasons.push("Explicit reinforcement is strong support.");
  return {
    memory_id: events[0]?.memory_id,
    counts,
    score,
    suggested_stability: suggestedStability(score, counts.explicit_correction),
    review_recommended: counts.explicit_correction > 0 || score < 0,
    reasons,
  };
}

function tokenSet(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3));
}

function overlap(a: string, b: string): number {
  const aTokens = tokenSet(a);
  const bTokens = tokenSet(b);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  const matches = [...aTokens].filter((token) => bTokens.has(token)).length;
  return matches / Math.min(aTokens.size, bTokens.size);
}

export function linkExplicitCorrectionToMemory(
  root: string,
  correctionText: string,
  selectedMemory: MemoryRecord[],
  context: { resource_id?: string; profile_id?: string; thread_id?: string; now?: string } = {},
): ReinforcementEvent | null {
  const scored = selectedMemory
    .filter((record) => record.status === "active")
    .map((record) => ({ record, score: overlap(correctionText, record.statement) }))
    .filter((item) => item.score >= 0.45)
    .sort((a, b) => b.score - a.score);

  if (scored.length !== 1) return null;

  const event = createReinforcementEvent({
    resource_id: context.resource_id ?? scored[0].record.resource_id,
    profile_id: context.profile_id ?? scored[0].record.profile_id,
    thread_id: context.thread_id ?? scored[0].record.thread_id,
    memory_id: scored[0].record.id,
    outcome: "explicit_correction",
    notes: correctionText.slice(0, 300),
    now: context.now,
  });
  return appendReinforcementEvent(root, event);
}
