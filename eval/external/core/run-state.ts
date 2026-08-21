import { existsSync, readFileSync } from "node:fs";
import type { BenchmarkTrack } from "./types";

export type SuccessStage = "planned" | "running" | "answered" | "evaluated" | "verified";
export type CaseStage = SuccessStage | "failed";
export type ResumeAction = "start" | "answer" | "evaluate" | "verify" | "skip";
export interface CaseStateEvent {
  caseId: string;
  track: BenchmarkTrack;
  stage: CaseStage;
  attempt: number;
  at: string;
  failedStage?: "running" | "answered" | "evaluated";
  errorClass?: string;
  retryable?: boolean;
}
const ORDER: SuccessStage[] = ["planned", "running", "answered", "evaluated", "verified"];

function assertEvent(event: CaseStateEvent): void {
  if (!event.caseId || !["production", "diagnostic"].includes(event.track) || !Number.isInteger(event.attempt) || event.attempt < 1 || !event.at) throw new Error("invalid case state event");
  if (event.stage === "failed" && (!event.failedStage || !event.errorClass || typeof event.retryable !== "boolean")) throw new Error("failed state requires stage, error class, and retry eligibility");
}
export function appendState(journal: readonly CaseStateEvent[], next: CaseStateEvent): CaseStateEvent[] {
  assertEvent(next);
  const scoped = journal.filter((item) => item.caseId === next.caseId && item.track === next.track);
  if (scoped.length === 0) {
    if (next.stage !== "planned") throw new Error("illegal case transition: first stage must be planned");
    return [...journal, next];
  }
  const previous = scoped.at(-1)!;
  if (previous.stage === "verified") throw new Error("illegal case transition after verified");
  if (next.stage === "failed") {
    if (previous.stage === "failed" || !["running", "answered", "evaluated"].includes(previous.stage)) throw new Error("illegal case failure transition");
    if (next.attempt !== previous.attempt) throw new Error("failure attempt must match current attempt");
    return [...journal, next];
  }
  if (previous.stage === "failed") {
    if (!previous.retryable) throw new Error("failed case is not retryable");
    if (next.attempt <= previous.attempt) throw new Error("attempt must increase after failure");
    if (next.stage !== previous.failedStage) throw new Error("retry must restart the failed stage");
    return [...journal, next];
  }
  const expected = ORDER[ORDER.indexOf(previous.stage) + 1];
  if (next.stage !== expected || next.attempt !== previous.attempt) throw new Error(`illegal case transition from ${previous.stage} to ${next.stage}`);
  return [...journal, next];
}
export function resumeAction(journal: readonly CaseStateEvent[]): ResumeAction {
  if (!journal.length) return "start";
  const last = journal.at(-1)!;
  if (last.stage === "failed") {
    if (!last.retryable) throw new Error(`case failed permanently during ${last.failedStage}`);
    if (last.failedStage === "running") return "answer";
    if (last.failedStage === "answered") return "evaluate";
    return "verify";
  }
  if (last.stage === "planned" || last.stage === "running") return "answer";
  if (last.stage === "answered") return "evaluate";
  if (last.stage === "evaluated") return "verify";
  return "skip";
}
export function readStateJournal(path: string): CaseStateEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as CaseStateEvent);
}
