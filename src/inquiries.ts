import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readJsonl, writeJsonl, appendJsonl, writeJsonlAtomic } from "./jsonl";
import { ensureMemoryDirs } from "./paths";
import { loadAllRecords } from "./store";
import type { CaptureCandidate, CandidateMatchKind, InquiryPriority, InquiryRecord, InquiryStatus } from "./types";

export interface InquiryStalenessPlan {
  dry_run: true;
  mutation_performed: false;
  fingerprint: string;
  review_window_days: number;
  open_scanned: number;
  stale_candidates: number;
  candidate_ids: string[];
}

export interface InquiryStalenessApplyResult {
  dry_run: false;
  mutation_performed: boolean;
  fingerprint: string;
  inquiries_staled: number;
  backup_path?: string;
  report_path?: string;
}

export interface InquiryTransitionResult {
  inquiry_id: string;
  previous_status: InquiryStatus;
  status: InquiryStatus;
  answer_memory_id?: string;
  updated_at: string;
}

const MAX_INJECTED_INQUIRIES = 3;

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

export function normalizeInquiryQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ").replace(/[?!.]+$/, "");
}

export interface CreateInquiryInput {
  question: string;
  context: string;
  tags?: string[];
  profile_id?: string;
  resource_id?: string;
  scope_level?: string;
  scope_ref?: string;
  related_memory_ids?: string[];
  related_evidence_ids?: string[];
  priority?: InquiryPriority;
  session_id?: string;
  now?: string;
}

export function createInquiryRecord(input: CreateInquiryInput): InquiryRecord {
  const now = input.now ?? new Date().toISOString();
  const sessionId = input.session_id ?? now;
  return {
    id: `inq_${hash(normalizeInquiryQuestion(input.question) + "\n" + (input.profile_id ?? ""))}`,
    resource_id: input.resource_id,
    profile_id: input.profile_id,
    question: input.question,
    context: input.context,
    scope_level: input.scope_level,
    scope_ref: input.scope_ref,
    tags: input.tags ?? [],
    related_memory_ids: input.related_memory_ids,
    related_evidence_ids: input.related_evidence_ids,
    sessions_touched: [sessionId],
    first_seen: now,
    last_seen: now,
    status: "open",
    priority: input.priority ?? "medium",
  };
}

export function appendInquiryRecord(root: string, record: InquiryRecord): InquiryRecord {
  const paths = ensureMemoryDirs(root);
  appendJsonl(paths.memory.inquiries, record);
  return record;
}

export function readInquiryRecords(root: string): InquiryRecord[] {
  const paths = ensureMemoryDirs(root);
  return readJsonl<InquiryRecord>(paths.memory.inquiries);
}

export function readOpenInquiries(root: string): InquiryRecord[] {
  return readInquiryRecords(root).filter((record) => record.status === "open");
}

export function findInquiryById(root: string, id: string): InquiryRecord | null {
  return readInquiryRecords(root).find((record) => record.id === id) ?? null;
}

function replaceInquiryRecord(root: string, id: string, updater: (record: InquiryRecord) => InquiryRecord): boolean {
  const paths = ensureMemoryDirs(root);
  const records = readInquiryRecords(root);
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) return false;
  records[index] = updater(records[index]);
  writeJsonl(paths.memory.inquiries, records);
  return true;
}

export function markInquiryAnswered(root: string, id: string, answerMemoryId: string, now = new Date().toISOString()): boolean {
  return replaceInquiryRecord(root, id, (record) => ({ ...record, status: "answered" as InquiryStatus, answer_memory_id: answerMemoryId, last_seen: now }));
}

export function markInquiryWithdrawn(root: string, id: string, now = new Date().toISOString()): boolean {
  return replaceInquiryRecord(root, id, (record) => ({ ...record, status: "withdrawn" as InquiryStatus, last_seen: now }));
}

export function markInquiryStale(root: string, id: string, now = new Date().toISOString()): boolean {
  return replaceInquiryRecord(root, id, (record) => ({ ...record, status: "stale" as InquiryStatus, last_seen: now }));
}

export function planInquiryStaleness(
  inquiries: InquiryRecord[],
  reviewWindowDays: number,
  now = new Date().toISOString(),
): InquiryStalenessPlan {
  const nowMs = Date.parse(now);
  const open = inquiries.filter((inquiry) => inquiry.status === "open");
  const candidateIds = open
    .filter((inquiry) => {
      const seen = Date.parse(inquiry.last_seen);
      return Number.isFinite(seen) && nowMs - seen > reviewWindowDays * 86_400_000;
    })
    .map((inquiry) => inquiry.id)
    .sort();
  const fingerprint = createHash("sha256").update(JSON.stringify({
    reviewWindowDays,
    inquiries: inquiries.map((inquiry) => ({ id: inquiry.id, status: inquiry.status, last_seen: inquiry.last_seen })),
    candidateIds,
  })).digest("hex");
  return {
    dry_run: true,
    mutation_performed: false,
    fingerprint,
    review_window_days: reviewWindowDays,
    open_scanned: open.length,
    stale_candidates: candidateIds.length,
    candidate_ids: candidateIds,
  };
}

export function applyInquiryStaleness(
  root: string,
  expectedFingerprint: string,
  reviewWindowDays: number,
  now = new Date().toISOString(),
): InquiryStalenessApplyResult {
  const paths = ensureMemoryDirs(root);
  const inquiries = readInquiryRecords(root);
  const plan = planInquiryStaleness(inquiries, reviewWindowDays, now);
  if (plan.fingerprint !== expectedFingerprint) throw new Error("Inquiry staleness preview is stale; run preview again.");
  const base = { dry_run: false as const, mutation_performed: false, fingerprint: plan.fingerprint, inquiries_staled: 0 };
  if (plan.candidate_ids.length === 0) return base;
  const slug = now.replace(/[^0-9]/g, "").slice(0, 17);
  const backupPath = join(root, "backups", `inquiry-staleness-v1-${slug}`);
  const backupFile = join(backupPath, "memory", "inquiries.jsonl");
  mkdirSync(dirname(backupFile), { recursive: true });
  copyFileSync(paths.memory.inquiries, backupFile);
  const candidates = new Set(plan.candidate_ids);
  const updated = inquiries.map((inquiry) => candidates.has(inquiry.id) && inquiry.status === "open" ? { ...inquiry, status: "stale" as const, last_seen: now } : inquiry);
  writeJsonlAtomic(paths.memory.inquiries, updated);
  const reportPath = join(root, "reports", `inquiry-staleness-${slug}.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  const result: InquiryStalenessApplyResult = { ...base, mutation_performed: true, inquiries_staled: candidates.size, backup_path: backupPath, report_path: reportPath };
  writeFileSync(reportPath, `${JSON.stringify({ ...result, plan }, null, 2)}\n`, "utf-8");
  return result;
}

export function transitionInquiry(
  root: string,
  input: { inquiry_id: string; status: "answered" | "withdrawn" | "stale"; answer_memory_id?: string; now?: string },
): InquiryTransitionResult {
  const now = input.now ?? new Date().toISOString();
  const paths = ensureMemoryDirs(root);
  const records = readInquiryRecords(root);
  const index = records.findIndex((record) => record.id === input.inquiry_id);
  if (index < 0) throw new Error(`Inquiry ${input.inquiry_id} not found.`);
  const inquiry = records[index];
  if (inquiry.status !== "open") throw new Error(`Inquiry ${input.inquiry_id} cannot transition from ${inquiry.status} to ${input.status}.`);
  if (input.status === "answered") {
    if (!input.answer_memory_id) throw new Error("Answering an inquiry requires --memory <memory-id>.");
    const memory = loadAllRecords(root).find((record) => record.id === input.answer_memory_id && record.status !== "deleted");
    if (!memory) throw new Error(`Answer memory ${input.answer_memory_id} does not exist or is deleted.`);
  }
  const updated: InquiryRecord = {
    ...inquiry,
    status: input.status,
    last_seen: now,
    ...(input.status === "answered" ? { answer_memory_id: input.answer_memory_id } : {}),
  };
  records[index] = updated;
  writeJsonl(paths.memory.inquiries, records);
  return {
    inquiry_id: inquiry.id,
    previous_status: inquiry.status,
    status: updated.status,
    ...(updated.answer_memory_id ? { answer_memory_id: updated.answer_memory_id } : {}),
    updated_at: now,
  };
}

export function upsertInquiryRecord(
  root: string,
  input: { question: string; profile_id?: string; session_id?: string; now?: string },
): InquiryRecord {
  const now = input.now ?? new Date().toISOString();
  const sessionId = input.session_id ?? now;
  const existingKey = normalizeInquiryQuestion(input.question) + "\n" + (input.profile_id ?? "");
  const existing = readOpenInquiries(root).find((record) =>
    record.profile_id === input.profile_id &&
    normalizeInquiryQuestion(record.question) === normalizeInquiryQuestion(input.question)
  );
  if (existing) {
    const updated = { ...existing, last_seen: now, sessions_touched: [...new Set([...existing.sessions_touched, sessionId])] };
    replaceInquiryRecord(root, existing.id, () => updated);
    return updated;
  }
  return appendInquiryRecord(root, { id: `inq_${hash(existingKey)}`, question: input.question, context: "", tags: [], sessions_touched: [sessionId], first_seen: now, last_seen: now, status: "open", priority: "medium", profile_id: input.profile_id });
}

const INQUIRY_MATCH_KINDS = new Set<CandidateMatchKind>(["ambiguous", "potential_conflict"]);

export function createInquiryFromCandidate(
  root: string,
  candidate: CaptureCandidate,
  ctx: { profile_id?: string; session_id?: string; now?: string } = {},
): InquiryRecord | null {
  if (!candidate.match_kind || !INQUIRY_MATCH_KINDS.has(candidate.match_kind)) return null;
  const question = candidate.match_kind === "ambiguous"
    ? `Candidate "${candidate.text.slice(0, 80)}" matches multiple existing memories. Which should it update, or is this a new memory?`
    : `Candidate "${candidate.text.slice(0, 80)}" conflicts with memory ${(candidate.matched_memory_ids ?? []).join(", ")}. Should it contest, supersede, or add an exception?`;
  const context = `Match kind: ${candidate.match_kind}. Matched memories: ${(candidate.matched_memory_ids ?? []).join(", ")}. Reasons: ${(candidate.match_reasons ?? []).join("; ")}.`;
  const profileId = ctx.profile_id ?? candidate.profile_id;
  const now = ctx.now ?? new Date().toISOString();
  const record = createInquiryRecord({
    question,
    context,
    tags: candidate.tags,
    profile_id: profileId,
    related_memory_ids: candidate.matched_memory_ids,
    priority: candidate.match_kind === "ambiguous" ? "medium" : "high",
    session_id: ctx.session_id,
    now,
  });
  const existing = readOpenInquiries(root).find((r) => r.id === record.id);
  if (existing) {
    const updated = { ...existing, last_seen: now, sessions_touched: [...new Set([...existing.sessions_touched, ctx.session_id ?? now])] };
    replaceInquiryRecord(root, existing.id, () => updated);
    return updated;
  }
  return appendInquiryRecord(root, record);
}

function tokenSet(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
}

function contextOverlap(inquiry: InquiryRecord, prompt: string, tags: string[]): number {
  const promptTokens = tokenSet(prompt);
  const questionTokens = tokenSet(inquiry.question);
  const tagOverlap = inquiry.tags.filter((tag) => tags.includes(tag)).length;
  const questionMatches = [...questionTokens].filter((token) => promptTokens.has(token)).length;
  return tagOverlap * 2 + questionMatches;
}

export interface SelectInquiriesInput {
  profile_id?: string;
  current_message?: string;
  tags?: string[];
  min_priority?: InquiryPriority;
  max_results?: number;
}

const PRIORITY_ORDER: Record<InquiryPriority, number> = { high: 2, medium: 1, low: 0 };

export function selectRelevantInquiries(root: string, input: SelectInquiriesInput): InquiryRecord[] {
  const { profile_id, current_message = "", tags = [], min_priority = "medium", max_results = MAX_INJECTED_INQUIRIES } = input;
  const minPriorityLevel = PRIORITY_ORDER[min_priority];
  const open = readOpenInquiries(root).filter((record) =>
    (!profile_id || !record.profile_id || record.profile_id === profile_id) &&
    PRIORITY_ORDER[record.priority] >= minPriorityLevel
  );
  return open
    .map((record) => ({ record, score: contextOverlap(record, current_message, tags) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => PRIORITY_ORDER[b.record.priority] - PRIORITY_ORDER[a.record.priority] || b.score - a.score)
    .slice(0, max_results)
    .map((item) => item.record);
}

export function renderInquiryInjectionBlock(inquiries: InquiryRecord[]): string {
  if (inquiries.length === 0) return "";
  const lines = inquiries.map((inq) => `? [${inq.priority}] ${inq.question}`);
  return `## Open Questions\n${lines.join("\n")}\n`;
}
