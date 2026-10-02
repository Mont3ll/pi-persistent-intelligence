import { describe, expect, test } from "bun:test";
import {
  SESSION_QMD_COLLECTION_NAME,
  SESSION_SEMANTIC_TIMEOUT_MS,
  qmdSessionSearchArgs,
  qmdSessionSetupArgs,
  runSessionSemanticSearch,
} from "../../src/session-semantic";

describe("semantic session retrieval", () => {
  test("uses a dedicated session-summary QMD collection", () => {
    expect(SESSION_QMD_COLLECTION_NAME).toBe("pi-persistent-intelligence-sessions");
    expect(qmdSessionSetupArgs("/tmp/pi-memory/sessions/summaries")).toEqual([
      "collection",
      "add",
      "/tmp/pi-memory/sessions/summaries",
      "--name",
      "pi-persistent-intelligence-sessions",
    ]);
    expect(qmdSessionSearchArgs("capture integrity", 8)).toEqual([
      "vsearch",
      "--json",
      "-c",
      "pi-persistent-intelligence-sessions",
      "-n",
      "8",
      "capture integrity",
    ]);
  });

  test("keeps explicit semantic session search within the 10 second UX ceiling", () => {
    expect(SESSION_SEMANTIC_TIMEOUT_MS).toBe(10_000);
  });

  test("reports successful semantic execution without invoking keyword fallback", async () => {
    let fallbackCalls = 0;
    let observedArgs: string[] = [];
    let observedTimeout = 0;

    const result = await runSessionSemanticSearch({
      query: "capture integrity",
      limit: 4,
      qmdRunner: async (args, timeoutMs) => {
        observedArgs = args;
        observedTimeout = timeoutMs;
        return { stdout: '[{"file":"qmd://pi-persistent-intelligence-sessions/session.md"}]' };
      },
      keywordFallback: async () => {
        fallbackCalls += 1;
        return "keyword fallback";
      },
    });

    expect(observedArgs).toEqual(qmdSessionSearchArgs("capture integrity", 4));
    expect(observedTimeout).toBe(SESSION_SEMANTIC_TIMEOUT_MS);
    expect(fallbackCalls).toBe(0);
    expect(result.text).toContain("pi-persistent-intelligence-sessions");
    expect(result.details).toEqual({
      requested_mode: "semantic",
      executed_mode: "semantic",
      fallback: false,
      qmd_collection: SESSION_QMD_COLLECTION_NAME,
      timeout_ms: SESSION_SEMANTIC_TIMEOUT_MS,
    });
  });

  test("makes timeout/error fallback visible instead of disguising keyword results as semantic", async () => {
    const result = await runSessionSemanticSearch({
      query: "confidence should not create policy",
      limit: 8,
      qmdRunner: async () => {
        throw new Error("qmd timed out");
      },
      keywordFallback: async () => "Found 3 native keyword sessions.",
    });

    expect(result.text).toContain("Semantic session search unavailable");
    expect(result.text).toContain("Found 3 native keyword sessions.");
    expect(result.details.requested_mode).toBe("semantic");
    expect(result.details.executed_mode).toBe("keyword");
    expect(result.details.fallback).toBe(true);
    expect(result.details.fallback_reason).toContain("qmd timed out");
    expect(result.details.qmd_collection).toBe(SESSION_QMD_COLLECTION_NAME);
    expect(result.details.timeout_ms).toBe(SESSION_SEMANTIC_TIMEOUT_MS);
  });
});
