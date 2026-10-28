import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { readSessionId } from "./sessions/parser";
import { resolveProjectIdentity } from "./profile";
import type { CaptureCandidate, EvidenceRecord } from "./types";

const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;
const MAX_SCANNED_FILES = 100_000;

export type TranscriptProofReason =
  | "verified"
  | "invalid_source_metadata"
  | "invalid_source_evidence"
  | "unresolved_source_identity"
  | "no_trusted_session_file"
  | "ambiguous_session_files"
  | "oversized_transcript"
  | "invalid_transcript"
  | "scope_mismatch"
  | "user_turn_missing"
  | "ambiguous_user_turn"
  | "source_excerpt_mismatch";

export interface TranscriptProofResult {
  verified: boolean;
  reason: TranscriptProofReason;
  /** Read-only proof; no user content or local transcript paths are returned. */
  source_hash?: string;
  matched_session_id?: string;
  matched_user_turn_id?: string;
  method?: "unique_user_message_hash";
}

export interface TranscriptProofOptions {
  /**
   * Trusted directories supplied by the host/verifier, NEVER by the candidate
   * or its source_ref. Omitted means Pi's standard live/archive session roots.
   */
  trustedSessionDirs?: readonly string[];
}

function hash(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}

function extractUserText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block): block is { type: "text"; text: string } =>
    typeof block === "object" && block !== null
    && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text).join("\n");
}

function defaultSessionDirectories(): string[] {
  return [
    join(homedir(), ".pi", "agent", "sessions"),
    join(homedir(), ".pi", "agent", "sessions-archive"),
  ];
}

function within(root: string, file: string): boolean {
  const relativePath = relative(root, file);
  return relativePath !== "" && relativePath !== ".."
    && !relativePath.startsWith(".." + sep)
    && !relativePath.startsWith(sep);
}

function sessionFiles(roots: readonly string[]): string[] {
  const found: string[] = [];
  let visited = 0;
  for (const rawRoot of roots) {
    if (!existsSync(rawRoot)) continue;
    const root = realpathSync(rawRoot);
    const pending = [root];
    while (pending.length) {
      const dir = pending.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (++visited > MAX_SCANNED_FILES) return [];
        const file = join(dir, entry.name);
        if (entry.isDirectory()) {
          pending.push(file);
          continue;
        }
        if (!entry.name.endsWith(".jsonl")) continue;
        // Do not follow symlinked transcripts outside the trusted root.
        let realFile: string;
        try { realFile = realpathSync(file); } catch { continue; }
        if (!within(root, realFile)) continue;
        found.push(realFile);
      }
    }
  }
  return [...new Set(found)];
}

function validSource(candidate: CaptureCandidate, evidence: EvidenceRecord): boolean {
  const source = candidate.capture_source;
  if (!source || source.version !== 1 || source.policy_version !== "capture-intent-v1"
    || source.identity_quality !== "observed_session_id"
    || !source.session_id || source.session_id === "current-session"
    || !source.turn_id || !/^[a-f0-9]{64}$/.test(source.original_message_sha256)) return false;
  const expectedRef = `session:${source.session_id}:turn:${source.turn_id}`;
  return candidate.status === "new"
    && candidate.evidence_refs.length === 1
    && candidate.evidence_ids?.length === 1
    && candidate.evidence_refs[0] === evidence.id
    && candidate.evidence_ids[0] === evidence.id
    && candidate.source.ref === expectedRef
    && (candidate.source.type === "direct_user_instruction"
      || candidate.source.type === "user_correction")
    && evidence.source_kind === "conversation"
    && evidence.notes === "capture_evidence_v1"
    && evidence.source_ref === expectedRef
    && evidence.source_session_id === source.session_id
    && evidence.source_turn_id === source.turn_id
    && evidence.source_message_sha256 === source.original_message_sha256
    && evidence.source_identity_quality === "observed_session_id"
    && evidence.source_summary === candidate.text
    && evidence.trust_class === candidate.source.type
    && evidence.polarity === "supports"
    && evidence.redaction_status !== "redacted"
    && evidence.redaction_status !== "deleted"
    && evidence.resource_id === (candidate.resource_id ?? "curation")
    && evidence.profile_id === (candidate.profile_id ?? "legacy-default");
}

function inspectedTranscript(
  file: string,
  expectedSessionId: string,
): { sessionId: string; cwd: string; userTurns: Array<{ text: string; turnId?: string }> } | null {
  const raw = readFileSync(file, "utf8");
  const lines = raw.split("\n");
  let session: { id?: unknown; cwd?: unknown } | null = null;
  const userTurns: Array<{ text: string; turnId?: string }> = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj: any;
    try { obj = JSON.parse(line.trim()); } catch { return null; }
    if (obj.type === "session") {
      if (session) return null;
      if (obj.id !== expectedSessionId || typeof obj.cwd !== "string" || !obj.cwd) return null;
      session = obj;
      continue;
    }
    if (obj.type !== "message") continue;
    const msg = obj.message;
    if (!msg || msg.role !== "user" || msg.customType) continue;
    const text = extractUserText(msg.content);
    if (text.trim()) {
      const rawTurnId = msg.id ?? msg.messageId ?? obj.id ?? msg.timestamp ?? obj.timestamp;
      userTurns.push({
        text,
        turnId: typeof rawTurnId === "string" ? rawTurnId : undefined,
      });
    }
  }
  if (!session) return null;
  return { sessionId: expectedSessionId, cwd: session.cwd as string, userTurns };
}

/**
 * Proof is recomputed against source-of-record session JSONL, not accepted
 * from a mutable source_transcript_verified flag or candidate-provided path.
 * Unique full-message hash is the fallback when runtime event turn identifiers
 * are not present in the persisted transcript format.
 *
 * This function is deliberately read-only and makes no promotion decision.
 */
export function verifyCandidateTranscriptSource(
  candidate: CaptureCandidate,
  evidence: EvidenceRecord,
  options: TranscriptProofOptions = {},
): TranscriptProofResult {
  const held = (reason: TranscriptProofReason): TranscriptProofResult => ({ verified: false, reason });
  if (!validSource(candidate, evidence)) return held("invalid_source_evidence");
  const source = candidate.capture_source!;
  if (source.identity_quality !== "observed_session_id") return held("unresolved_source_identity");
  const target = candidate.scope_targets?.length === 1 ? candidate.scope_targets[0] : undefined;
  if (target?.type !== "project" || !target.project) return held("invalid_source_metadata");

  const matching: string[] = [];
  try {
    for (const file of sessionFiles(options.trustedSessionDirs ?? defaultSessionDirectories())) {
      if (statSync(file).size < 2) continue;
      // Only a bounded header read during discovery; open full transcript
      // after an exact session-id match and size check.
      if (readSessionId(file) === source.session_id) matching.push(file);
      if (matching.length > 1) return held("ambiguous_session_files");
    }
    if (matching.length !== 1) return held("no_trusted_session_file");
    if (statSync(matching[0]!).size > MAX_TRANSCRIPT_BYTES) return held("oversized_transcript");
    const transcript = inspectedTranscript(matching[0]!, source.session_id);
    if (!transcript) return held("invalid_transcript");
    // Project identity must be derived independently from the trusted Pi
    // session header, not from the candidate's proposed target alone.
    if (resolveProjectIdentity(resolve(transcript.cwd)).project_id !== target.project) return held("scope_mismatch");
    const turns = transcript.userTurns.filter((turn) =>
      hash(turn.text) === source.original_message_sha256);
    if (turns.length === 0) return held("user_turn_missing");
    if (turns.length > 1) return held("ambiguous_user_turn");
    const full = turns[0]!.text.trim();
    const excerpt = full.slice(0, 300).replace(/\s+/g, " ");
    if (full.length !== source.original_character_count
      || excerpt !== candidate.text
      || excerpt.length !== source.persisted_excerpt_character_count
      || evidence.source_summary !== excerpt) return held("source_excerpt_mismatch");
    return {
      verified: true,
      reason: "verified",
      source_hash: source.original_message_sha256,
      matched_session_id: source.session_id,
      matched_user_turn_id: turns[0]!.turnId,
      method: "unique_user_message_hash",
    };
  } catch {
    return held("invalid_transcript");
  }
}
