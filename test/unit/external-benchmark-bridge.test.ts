import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseBridgeRequest, parseBridgeResponse, RequestIdRegistry } from "../../eval/external/core/protocol";
import { runProcess } from "../../eval/external/core/process";

const roots: string[] = [];
afterEach(() => roots.splice(0));

describe("external benchmark bridge", () => {
  test("validates bounded requests and responses", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-bridge-")); roots.push(root);
    expect(parseBridgeRequest(JSON.stringify({ id: "1", op: "open", root, track: "production", config: { maxRecords: 3, maxChars: 1000 } })).op).toBe("open");
    expect(() => parseBridgeRequest(JSON.stringify({ id: "1", op: "unknown" }))).toThrow("unknown bridge operation");
    expect(() => parseBridgeRequest(JSON.stringify({ id: "1", op: "insert", caseId: "c", items: [{ id: "i", role: "bad", content: "x", at: "2026-01-01" }] }))).toThrow("role");
    expect(() => parseBridgeRequest('{"id":"1","op":"close","caseId":"c"}\u0000')).toThrow("NUL");
    expect(parseBridgeResponse('{"id":"1","ok":true,"result":{}}').ok).toBe(true);
  });
  test("rejects duplicate request identifiers", () => {
    const registry = new RequestIdRegistry(); registry.accept("a");
    expect(() => registry.accept("a")).toThrow("duplicate request id");
  });
  test("persistent worker requires open and returns one response per request", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-bridge-worker-")); roots.push(root);
    const input = [
      { id: "1", op: "query", caseId: "c", query: { text: "preference" } },
      { id: "2", op: "open", root, track: "diagnostic", config: { maxRecords: 3, maxChars: 1000 } },
      { id: "3", op: "insert", caseId: "c", items: [{ id: "i1", role: "user", content: "Prefer Bun for tests", at: "2026-08-01T00:00:00Z" }] },
      { id: "4", op: "query", caseId: "c", query: { text: "Which test runner?" } },
      { id: "5", op: "close", caseId: "c" },
    ].map((item) => JSON.stringify(item)).join("\n") + "\n";
    const result = await runProcess(["bun", "eval/external/bridge-worker.ts"], { input, timeoutMs: 10_000 });
    expect(result.code).toBe(0);
    const lines = result.stdout.trim().split("\n").map((line) => parseBridgeResponse(line));
    expect(lines).toHaveLength(5); expect(lines[0].ok).toBe(false); expect(lines[3].ok).toBe(true);
  });
  test("fake Python benchmark communicates over JSONL", async () => {
    const result = await runProcess(["python3", "eval/external/fixtures/fake-benchmark.py", "--worker", "bun eval/external/bridge-worker.ts"], { timeoutMs: 10_000 });
    expect(result.code).toBe(0); expect(result.stdout).toContain("Prefer Bun for tests");
  });
});
