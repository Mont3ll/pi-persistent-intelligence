import { describe, expect, test } from "bun:test";
import { InvocationProfiler, renderInvocationProfileReport } from "../../src/profiling";

describe("InvocationProfiler", () => {
  test("records ordered spans and total duration", () => {
    let now = 100;
    const profiler = new InvocationProfiler("recall_xray", () => now);

    const endRetrieve = profiler.startSpan("candidate_retrieval");
    now = 112;
    endRetrieve({ candidates: 4, privatePayload: "should-not-serialize" });
    const value = profiler.measure("ranking", () => {
      now = 120;
      return "ranked";
    });

    const report = profiler.toReport();

    expect(value).toBe("ranked");
    expect(report.name).toBe("recall_xray");
    expect(report.total_ms).toBe(20);
    expect(report.spans.map((span) => span.name)).toEqual(["candidate_retrieval", "ranking"]);
    expect(report.spans[0].duration_ms).toBe(12);
    expect(JSON.stringify(report)).not.toContain("should-not-serialize");
  });

  test("supports async measurements", async () => {
    let now = 0;
    const profiler = new InvocationProfiler("doctor", () => now);

    const result = await profiler.measureAsync("evidence_lookup", async () => {
      now = 9;
      return 42;
    });

    expect(result).toBe(42);
    expect(profiler.toReport().spans[0]).toMatchObject({ name: "evidence_lookup", duration_ms: 9 });
  });

  test("renders readable timing breakdowns", () => {
    let now = 0;
    const profiler = new InvocationProfiler("recall", () => now);
    const end = profiler.startSpan("ranking");
    now = 7;
    end({ records: 12 });
    const text = renderInvocationProfileReport(profiler.toReport());

    expect(text).toContain("Profile: recall");
    expect(text).toContain("ranking: 7ms");
    expect(text).toContain("records=12");
  });
});
