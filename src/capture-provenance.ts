import { createHash } from "node:crypto";

/**
 * Additive source contract for new captures. Historical records with unknown
 * attribution remain unknown; do not invent a direct-user transcript link.
 */
export const CAPTURE_POLICY_VERSION = "capture-intent-v1" as const;
export type CaptureSourceIdentityQuality = "observed_session_id" | "unresolved";

export interface CaptureSourceAttribution {
  version: 1;
  policy_version: typeof CAPTURE_POLICY_VERSION;
  session_id: string;
  turn_id: string;
  identity_quality: CaptureSourceIdentityQuality;
  original_message_sha256: string;
  transcript_verification: "unverified";
  original_character_count: number;
  persisted_excerpt_character_count: number;
}

type CaptureSessionManager = { getSessionId?: () => unknown };
type CaptureEvent = { session_id?: unknown; sessionId?: unknown };
type CaptureContext = { sessionManager?: CaptureSessionManager } | undefined;

function validSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id && id !== "current-session" && id !== "unknown" ? id : null;
}

/**
 * An agent_end event often has no session_id. Prefer the host session manager
 * rather than stamping every source with the ambiguous "current-session".
 * An unresolved fallback is explicitly marked. Even observed session IDs
 * must be checked against original transcript content before granting authority.
 */
export function resolveCaptureSessionIdentity(
  event: CaptureEvent,
  context?: CaptureContext,
): { session_id: string; identity_quality: CaptureSourceIdentityQuality } {
  const fromEvent = validSessionId(event.session_id) ?? validSessionId(event.sessionId);
  if (fromEvent) return { session_id: fromEvent, identity_quality: "observed_session_id" };
  let managerId: unknown;
  try { managerId = context?.sessionManager?.getSessionId?.(); } catch { /* unavailable */ }
  const fromManager = validSessionId(managerId);
  return fromManager
    ? { session_id: fromManager, identity_quality: "observed_session_id" }
    : { session_id: "current-session", identity_quality: "unresolved" };
}

export function buildCaptureSourceAttribution(
  sessionId: string,
  turnId: string,
  originalMessage: string,
  persistedExcerpt: string,
): CaptureSourceAttribution {
  const source = originalMessage.trim();
  return {
    version: 1,
    policy_version: CAPTURE_POLICY_VERSION,
    session_id: sessionId,
    turn_id: turnId,
    identity_quality: validSessionId(sessionId) ? "observed_session_id" : "unresolved",
    original_message_sha256: createHash("sha256").update(source).digest("hex"),
    transcript_verification: "unverified",
    original_character_count: source.length,
    persisted_excerpt_character_count: persistedExcerpt.length,
  };
}
