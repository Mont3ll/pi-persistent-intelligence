import type { CaptureCandidate, MemoryKind, MemoryRecord } from "./types";

const KINDS = new Set<MemoryKind>(["fact", "event", "instruction", "task"]);

export function normalizeMemoryKind(value: unknown): MemoryKind | undefined {
  return typeof value === "string" && KINDS.has(value as MemoryKind) ? value as MemoryKind : undefined;
}

function textOf(input: MemoryRecord | CaptureCandidate | string): string {
  if (typeof input === "string") return input;
  return `${(input as MemoryRecord).statement ?? (input as CaptureCandidate).text ?? ""} ${(input as MemoryRecord).ruleType ?? (input as CaptureCandidate).ruleType ?? ""} ${((input as MemoryRecord).tags ?? (input as CaptureCandidate).tags ?? []).join(" ")}`.toLowerCase();
}

export function inferMemoryKind(input: MemoryRecord | CaptureCandidate | string): MemoryKind {
  const explicit = typeof input === "object" && input ? normalizeMemoryKind((input as any).memory_kind) : undefined;
  if (explicit) return explicit;
  const text = textOf(input);
  if (/\b(todo|follow up|next step|pending|remind|task|temporary|short-lived|waiting for)\b/.test(text)) return "task";
  if (/\b(published|released|completed|decided|milestone|session|happened|done|fixed|shipped)\b/.test(text)) return "event";
  if (/\b(this project uses|package is|version is|current state|fact:)\b/.test(text)) return "fact";
  if (/\b(always|never|prefer|avoid|do not|don't|use .* instead|workflow|rule|procedure|convention|testing)\b/.test(text)) return "instruction";
  return "fact";
}
