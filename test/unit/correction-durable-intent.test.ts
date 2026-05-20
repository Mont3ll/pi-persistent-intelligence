import { describe, expect, test } from "bun:test";
import { maybeCorrectionSignal, extractCorrectionCandidate } from "../../src/corrections";

describe("durable-intent correction patterns ('prefer X before Y')", () => {
  test("detects 'going forward, prefer X before Y'", () => {
    expect(maybeCorrectionSignal("Going forward, prefer bun test before typecheck in this project.")).toBe(true);
  });

  test("detects 'from now on, always use X'", () => {
    expect(maybeCorrectionSignal("From now on, always use bun for integration tests.")).toBe(true);
  });

  test("detects 'in the future, prefer X before Y'", () => {
    expect(maybeCorrectionSignal("In the future, prefer bun before typecheck.")).toBe(true);
  });

  test("does not fire on temporal 'before' without durable-intent phrase", () => {
    expect(maybeCorrectionSignal("Run the tests before the meeting.")).toBe(false);
  });

  test("durable-intent captures with prefer_pattern ruleType", () => {
    const cand = extractCorrectionCandidate("Going forward, prefer bun test before typecheck.", "2026-05-20", "/tmp");
    expect(cand).not.toBeNull();
    expect(cand!.ruleType).toBe("prefer_pattern");
  });
});
