import type { SemanticAdapter } from "./semantic-assessment";
import { commandSemanticAdapter } from "./semantic-assessment-command";

interface PersistedUserEntry {
  type: string;
  id?: unknown;
  message?: { role?: unknown; content?: unknown; timestamp?: unknown; customType?: unknown };
}
export interface SemanticSessionManager {
  getSessionId?: () => unknown;
  getEntries?: () => readonly PersistedUserEntry[];
}

function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b): b is { type: "text"; text: string } =>
    b && typeof b === "object" && b.type === "text" && typeof b.text === "string")
    .map(b => b.text).join("\n");
}

/**
 * Never fabricate the authoritative Pi v3 message-entry ID from runtime
 * timestamps, array positions or user text. Only an existing persistent
 * SessionManager entry can serve as a semantic auto source identity.
 * A duplicated text without a unique event match holds for later review.
 */
export function resolvePersistedSemanticUserTurn(
  manager: SemanticSessionManager | undefined,
  runtimeMessage: { id?: unknown; messageId?: unknown; timestamp?: unknown; content?: unknown },
): { turnId: string; text: string } | null {
  if (!manager?.getEntries) return null;
  const target = userText(runtimeMessage.content);
  if (!target.trim()) return null;
  let entries: readonly PersistedUserEntry[];
  try { entries = manager.getEntries(); }
  catch { return null; }
  if (!Array.isArray(entries)) return null;
  const matches = entries.filter(entry =>
    entry.type === "message" && typeof entry.id === "string"
    && entry.message?.role === "user" && !entry.message.customType
    && userText(entry.message.content) === target);
  const runtimeId = runtimeMessage.id ?? runtimeMessage.messageId;
  const byId = matches.filter(entry => entry.id === runtimeId);
  if (typeof runtimeId === "string" && byId.length === 1)
    return { turnId: byId[0]!.id as string, text: userText(byId[0]!.message?.content) };
  const byTime = matches.filter(entry =>
    typeof runtimeMessage.timestamp === "number"
    && entry.message?.timestamp === runtimeMessage.timestamp);
  if (byTime.length === 1)
    return { turnId: byTime[0]!.id as string, text: userText(byTime[0]!.message?.content) };
  return matches.length === 1
    ? { turnId: matches[0]!.id as string, text: userText(matches[0]!.message?.content) }
    : null;
}

/**
 * Model calls require BOTH explicit local feature selection and individual
 * provider/model/credential/data-transmission opt-in. These environment
 * variables are never read or passed to a model when the feature is off.
 * The child executable is not an OS sandbox; genuine private-data approval
 * and isolation remain release-blocking.
 */
export function configuredSemanticAutoAdapter(): SemanticAdapter | null {
  const bin = process.env.PI_R4_MODEL_BIN?.trim();
  const argsJson = process.env.PI_R4_MODEL_ARGS;
  if (process.env.PI_R4_DATA_TRANSMISSION_APPROVED !== "yes"
    || !process.env.PI_R4_PI_PROVIDER?.trim()
    || !process.env.PI_R4_PI_MODEL?.trim()
    || !process.env.PI_R4_PI_API_KEY?.trim()
    || !bin || !argsJson) return null;
  try {
    const args: unknown = JSON.parse(argsJson);
    if (!Array.isArray(args) || args.length === 0
      || args.length > 8 || !args.every(arg => typeof arg === "string"
        && arg.length <= 1024)) return null;
    return commandSemanticAdapter(bin, args, 20_000);
  } catch { return null; }
}
