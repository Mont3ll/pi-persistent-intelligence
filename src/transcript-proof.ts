import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { resolveProjectIdentity } from "./profile";
import type { CaptureCandidate, EvidenceRecord } from "./types";

const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;
const MAX_SCANNED_FILES = 100_000;
const MAX_HEADER_BYTES = 4096;
const READ_CHUNK_BYTES = 64 * 1024;
const NONBLOCKING_REGULAR_FILE_FLAGS = constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0);

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

export interface TranscriptDiscoveryIndex {
  /** Discovery hints only. Source identity is rechecked from the opened file. */
  readonly bySessionId: ReadonlyMap<string, readonly string[]>;
  readonly scannedFiles: number;
}

export interface TranscriptProofOptions {
  /**
   * Trusted directories supplied by the host/verifier, NEVER by the candidate
   * or its source_ref. Omitted means Pi's standard live/archive session roots.
   */
  trustedSessionDirs?: readonly string[];
  /** In-memory hint scoped to one curation pass; never persisted or trusted at apply. */
  discoveryIndex?: TranscriptDiscoveryIndex;
}

function hash(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}
function exactHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
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

/**
 * Never call the general session parser's readSessionId() on a path that
 * might be replaced by an untrusted filesystem node. Its blocking open()
 * can hang forever on a FIFO. Open nonblocking, reject non-regular descriptors,
 * and read only a bounded first line. This is not itself proof of
 * trusted path containment or user authorship; those checks are separate.
 */
export function readNonblockingSessionId(file: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, NONBLOCKING_REGULAR_FILE_FLAGS);
    const before = fstatSync(fd);
    if (!before.isFile()) return null;
    const bytes = Buffer.alloc(MAX_HEADER_BYTES);
    const n = readSync(fd, bytes, 0, bytes.length, 0);
    const after = fstatSync(fd);
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs) return null;
    const text = bytes.toString("utf8", 0, n);
    const header = text.split("\n", 1)[0] ?? "";
    if (n === MAX_HEADER_BYTES && !text.includes("\n")) return null;
    const parsed: unknown = JSON.parse(header.replace(/^\uFEFF/, "").trim());
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as { type?: unknown; id?: unknown };
    return row.type === "session" && typeof row.id === "string" && row.id.trim() ? row.id : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
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
          // Do not enqueue paths that are no longer directories or have
          // resolved outside the trusted root before traversal.
          try {
            if (!lstatSync(file).isDirectory()) continue;
            const realDir = realpathSync(file);
            if (within(root, realDir)) pending.push(realDir);
          } catch { /* transient / invalid directory cannot supply proof */ }
          continue;
        }
        if (!entry.name.endsWith(".jsonl") || !entry.isFile()) continue;
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

/**
 * Discover session IDs once per curation operation instead of scanning all
 * session headers repeatedly for every candidate. This index has NO grant
 * authority: every matched file is independently rechecked when opened.
 */
export function createTranscriptDiscoveryIndex(
  options: TranscriptProofOptions = {},
): TranscriptDiscoveryIndex {
  const paths = sessionFiles(options.trustedSessionDirs ?? defaultSessionDirectories());
  const map = new Map<string, string[]>();
  for (const file of paths) {
    try {
      const id = readNonblockingSessionId(file);
      if (!id) continue;
      const existing = map.get(id) ?? [];
      existing.push(file);
      map.set(id, existing);
    } catch { /* unreadable files cannot authorize proof */ }
  }
  return { bySessionId: map, scannedFiles: paths.length };
}

function trustedRealRoots(options: TranscriptProofOptions): string[] {
  return (options.trustedSessionDirs ?? defaultSessionDirectories())
    .filter((root) => existsSync(root))
    .map((root) => realpathSync(root));
}

function trustedTranscriptPath(file: string, roots: readonly string[]): boolean {
  try {
    if (!lstatSync(file).isFile()) return false;
    const realFile = realpathSync(file);
    return roots.some((root) => within(root, realFile));
  } catch { return false; }
}

function validSource(candidate: CaptureCandidate, evidence: EvidenceRecord): boolean {
  const source = candidate.capture_source;
  const validPolicy = source && (source.version === 1
    ? source.policy_version === "capture-intent-v1"
    : source.version === 2 && source.policy_version === "capture-semantic-v1"
      && Number.isSafeInteger(source.proposition_start)
      && Number.isSafeInteger(source.proposition_end)
      && source.proposition_start >= 0
      && source.proposition_end > source.proposition_start
      && source.proposition_end <= source.original_character_count
      && source.proposition_end - source.proposition_start === candidate.text.length
      && candidate.text.length <= 300);
  if (!source || !validPolicy
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
    && evidence.notes === (source.version === 2 ? "capture_evidence_semantic_v1" : "capture_evidence_v1")
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
  // A non-blocking, no-follow open is essential: paths can turn into FIFOs
  // between discovery and inspection. Inspect only regular files, with a
  // hard 32 MiB read cap and identity checks before/after.
  const fd = openSync(file, NONBLOCKING_REGULAR_FILE_FLAGS);
  let raw: string;
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > MAX_TRANSCRIPT_BYTES || before.size < 2) return null;
    const parts: Buffer[] = [];
    let offset = 0;
    while (offset <= MAX_TRANSCRIPT_BYTES) {
      const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, MAX_TRANSCRIPT_BYTES + 1 - offset));
      const n = readSync(fd, chunk, 0, chunk.length, offset);
      if (n === 0) break;
      parts.push(chunk.subarray(0, n));
      offset += n;
    }
    if (offset > MAX_TRANSCRIPT_BYTES) return null;
    const after = fstatSync(fd);
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs || offset !== before.size) return null;
    // Catch a pathname/directory replacement during descriptor reading.
    const current = statSync(file);
    if (!lstatSync(file).isFile() || current.dev !== after.dev || current.ino !== after.ino) return null;
    raw = Buffer.concat(parts, offset).toString("utf8");
  } finally { closeSync(fd); }
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

  try {
    const roots = trustedRealRoots(options);
    const index = options.discoveryIndex ?? createTranscriptDiscoveryIndex(options);
    const matching = index.bySessionId.get(source.session_id) ?? [];
    if (matching.length > 1) return held("ambiguous_session_files");
    if (matching.length !== 1) return held("no_trusted_session_file");
    const sourceFile = matching[0]!;
    // Recheck both trusted containment and exact session identity. The
    // ephemeral discovery index is not an authorization source.
    if (!trustedTranscriptPath(sourceFile, roots)) return held("invalid_transcript");
    if (statSync(sourceFile).size > MAX_TRANSCRIPT_BYTES) return held("oversized_transcript");
    if (readNonblockingSessionId(sourceFile) !== source.session_id) return held("invalid_transcript");
    const transcript = inspectedTranscript(sourceFile, source.session_id);
    if (!transcript) return held("invalid_transcript");
    // Project identity must be derived independently from the trusted Pi
    // session header, not from the candidate's proposed target alone.
    if (resolveProjectIdentity(resolve(transcript.cwd)).project_id !== target.project) return held("scope_mismatch");
    const turns = transcript.userTurns.filter((turn) =>
      (source.version === 2 ? exactHash(turn.text) : hash(turn.text))
        === source.original_message_sha256);
    if (turns.length === 0) return held("user_turn_missing");
    if (turns.length > 1) return held("ambiguous_user_turn");
    // Historical v1 can legitimately lack a reliable message ID and retains
    // unique full-message-hash fallback. Semantic v2, however, confers a
    // specific proposition-to-turn binding: do not accept merely because an
    // unrelated user turn happens to contain identical source bytes.
    if (source.version === 2 && (!turns[0]!.turnId
      || turns[0]!.turnId !== source.turn_id)) return held("user_turn_missing");
    const full = source.version === 2 ? turns[0]!.text : turns[0]!.text.trim();
    const excerpt = source.version === 2
      ? full.slice(source.proposition_start, source.proposition_end)
      : full.slice(0, 300).replace(/\s+/g, " ");
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
