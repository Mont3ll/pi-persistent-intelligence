import { createInterface } from "node:readline";
import { parseBridgeRequest, RequestIdRegistry, type BridgeResponse } from "./core/protocol";
import { createDiagnosticTrack } from "./pi/diagnostic-track";
import { createProductionTrack } from "./pi/production-track";
import type { BenchmarkTrackRunner } from "./pi/types";

let runner: BenchmarkTrackRunner | null = null;
const ids = new RequestIdRegistry();

function success(id: string, result: unknown): BridgeResponse { return { id, ok: true, result }; }
function failure(id: string, error: unknown): BridgeResponse { const message = error instanceof Error ? error.message : String(error); return { id, ok: false, error: { code: /open/i.test(message) ? "not_open" : "request_failed", message: message.slice(0, 1000), retryable: false } }; }
async function handle(line: string): Promise<BridgeResponse> {
  let requestId = "invalid";
  try {
    const request = parseBridgeRequest(line); requestId = request.id; ids.accept(request.id);
    if (request.op === "open") {
      if (runner) throw new Error("worker already open");
      runner = request.track === "production" ? createProductionTrack(request.root, request.config) : createDiagnosticTrack(request.root, request.config);
      return success(request.id, { opened: true, track: request.track });
    }
    if (!runner) throw new Error("worker must open before insert, query, or close");
    if (request.op === "insert") return success(request.id, await runner.insert(request.caseId, request.items));
    if (request.op === "query") return success(request.id, await runner.query(request.caseId, request.query));
    await runner.close(request.caseId); return success(request.id, { closed: true });
  } catch (error) { return failure(requestId, error); }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) { if (!line) continue; const response = await handle(line); process.stdout.write(`${JSON.stringify(response)}\n`); }
