import type { BenchmarkTrack } from "./types";

export const MAX_BRIDGE_LINE_BYTES = 8 * 1024 * 1024;
export type HistoryRole = "user" | "assistant" | "tool" | "system" | "observation";
export interface BenchmarkHistoryItem { id: string; role: HistoryRole; content: string; at: string; metadata?: Record<string, unknown> }
export interface BenchmarkQuery { text: string; image?: string }
export interface TrackConfig { maxRecords: number; maxChars: number; now?: string }
export type BridgeRequest =
  | { id: string; op: "open"; root: string; track: BenchmarkTrack; config: TrackConfig }
  | { id: string; op: "insert"; caseId: string; items: BenchmarkHistoryItem[] }
  | { id: string; op: "query"; caseId: string; query: BenchmarkQuery }
  | { id: string; op: "close"; caseId: string };
export type BridgeResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: { code: string; message: string; retryable: boolean } };

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string { if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`); return value; }
function parseLine(line: string): Record<string, unknown> {
  if (line.includes("\0")) throw new Error("bridge line contains NUL byte");
  if (Buffer.byteLength(line) > MAX_BRIDGE_LINE_BYTES) throw new Error("bridge line exceeds 8 MiB limit");
  return object(JSON.parse(line), "bridge message");
}
export function parseBridgeRequest(line: string): BridgeRequest {
  const value = parseLine(line); const id = string(value.id, "request id"); const op = string(value.op, "operation");
  if (op === "open") { const config = object(value.config, "track config"); const track = value.track; if (track !== "production" && track !== "diagnostic") throw new Error("invalid track"); if (typeof config.maxRecords !== "number" || typeof config.maxChars !== "number") throw new Error("invalid track limits"); return { id, op, root: string(value.root, "root"), track, config: config as unknown as TrackConfig }; }
  if (op === "insert") { if (!Array.isArray(value.items)) throw new Error("items must be an array"); const roles = new Set(["user", "assistant", "tool", "system", "observation"]); const items = value.items.map((raw) => { const item = object(raw, "history item"); if (!roles.has(String(item.role))) throw new Error("invalid history item role"); const metadata = item.metadata === undefined ? undefined : object(item.metadata, "history item metadata"); return { id: string(item.id, "history item id"), role: item.role as HistoryRole, content: string(item.content, "history item content"), at: string(item.at, "history item timestamp"), metadata }; }); return { id, op, caseId: string(value.caseId, "case id"), items }; }
  if (op === "query") { const query = object(value.query, "query"); return { id, op, caseId: string(value.caseId, "case id"), query: { text: string(query.text, "query text"), image: typeof query.image === "string" ? query.image : undefined } }; }
  if (op === "close") return { id, op, caseId: string(value.caseId, "case id") };
  throw new Error(`unknown bridge operation: ${op}`);
}
export function parseBridgeResponse(line: string): BridgeResponse {
  const value = parseLine(line); const id = string(value.id, "response id");
  if (value.ok === true) return { id, ok: true, result: value.result };
  if (value.ok === false) { const error = object(value.error, "bridge error"); return { id, ok: false, error: { code: string(error.code, "error code"), message: string(error.message, "error message"), retryable: error.retryable === true } }; }
  throw new Error("bridge response requires boolean ok");
}
export class RequestIdRegistry { private readonly ids = new Set<string>(); accept(id: string): void { if (this.ids.has(id)) throw new Error(`duplicate request id: ${id}`); this.ids.add(id); } }
