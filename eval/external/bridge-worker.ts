import { createInterface } from "node:readline";
import { parseBridgeRequest, RequestIdRegistry, type BenchmarkHistoryItem, type BridgeResponse, type TrackConfig } from "./core/protocol";
import type { BenchmarkTrack } from "./core/types";

interface OpenState { root: string; track: BenchmarkTrack; config: TrackConfig }
let opened: OpenState | null = null;
const histories = new Map<string, BenchmarkHistoryItem[]>();
const ids = new RequestIdRegistry();

function success(id: string, result: unknown): BridgeResponse { return { id, ok: true, result }; }
function failure(id: string, error: unknown): BridgeResponse { const message = error instanceof Error ? error.message : String(error); return { id, ok: false, error: { code: /open/i.test(message) ? "not_open" : "request_failed", message: message.slice(0, 1000), retryable: false } }; }
async function handle(line: string): Promise<BridgeResponse> {
  let requestId = "invalid";
  try {
    const request = parseBridgeRequest(line); requestId = request.id; ids.accept(request.id);
    if (request.op === "open") { if (opened) throw new Error("worker already open"); opened = { root: request.root, track: request.track, config: request.config }; return success(request.id, { opened: true, track: request.track }); }
    if (!opened) throw new Error("worker must open before insert, query, or close");
    if (request.op === "insert") { histories.set(request.caseId, [...(histories.get(request.caseId) ?? []), ...request.items]); return success(request.id, { inserted: request.items.length }); }
    if (request.op === "query") {
      const items = histories.get(request.caseId) ?? []; const selected = items.slice(-opened.config.maxRecords); const context = selected.map((item) => item.content).join("\n").slice(0, opened.config.maxChars);
      return success(request.id, { context, selectedIds: selected.map((item) => item.id), diagnostic: opened.track === "diagnostic" });
    }
    histories.delete(request.caseId); return success(request.id, { closed: true });
  } catch (error) { return failure(requestId, error); }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) { if (!line) continue; const response = await handle(line); process.stdout.write(`${JSON.stringify(response)}\n`); }
