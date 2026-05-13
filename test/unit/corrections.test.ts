import { describe, expect, test } from "bun:test";
import { maybeCorrectionSignal, correctionConfidence, extractCorrectionCandidate } from "../../src/corrections";

describe("maybeCorrectionSignal", () => {
  test("detects 'don't use X' pattern", () => {
    expect(maybeCorrectionSignal("Don't use regex here, use the Zod schemas")).toBe(true);
    expect(maybeCorrectionSignal("do not use echo >> for file writes")).toBe(true);
  });

  test("detects 'prefer X over Y' pattern", () => {
    expect(maybeCorrectionSignal("prefer bun over npm in this project")).toBe(true);
    expect(maybeCorrectionSignal("favor conventional commits over custom formats")).toBe(true);
  });

  test("detects 'use X instead' pattern", () => {
    expect(maybeCorrectionSignal("use sed instead of echo >> for vault notes")).toBe(true);
    expect(maybeCorrectionSignal("use bun install instead of npm install")).toBe(true);
  });

  test("detects 'always/never' instructions", () => {
    expect(maybeCorrectionSignal("always run typecheck before pushing")).toBe(true);
    expect(maybeCorrectionSignal("never edit the rendered MEMORY.md directly")).toBe(true);
  });

  test("detects 'this project uses' pattern", () => {
    expect(maybeCorrectionSignal("this project uses bun not node")).toBe(true);
  });

  test("ignores slash commands", () => {
    expect(maybeCorrectionSignal("/curate-memory")).toBe(false);
    expect(maybeCorrectionSignal("/reload")).toBe(false);
  });

  test("ignores conversational filler", () => {
    expect(maybeCorrectionSignal("ok")).toBe(false);
    expect(maybeCorrectionSignal("thanks")).toBe(false);
    expect(maybeCorrectionSignal("looks good")).toBe(false);
  });

  test("ignores very short messages", () => {
    expect(maybeCorrectionSignal("use")).toBe(false);
    expect(maybeCorrectionSignal("ok try")).toBe(false);
  });

  test("ignores parenthetical always/never in conversational context", () => {
    // Should NOT fire on code comments like "(always pass the context)"
    expect(maybeCorrectionSignal("for now")).toBe(false);
  });
});

describe("correctionConfidence", () => {
  test("high confidence for explicit patterns", () => {
    expect(correctionConfidence("always use canonical JSONL as the source of truth")).toBeGreaterThanOrEqual(0.85);
    expect(correctionConfidence("never edit the rendered markdown file")).toBeGreaterThanOrEqual(0.85);
    expect(correctionConfidence("do not use echo >> for file writes")).toBeGreaterThanOrEqual(0.85);
  });

  test("medium confidence for softer patterns", () => {
    const conf = correctionConfidence("we should use bun here");
    expect(conf).toBeGreaterThanOrEqual(0.65);
    expect(conf).toBeLessThan(0.85);
  });

  test("returns lower confidence for weak signals", () => {
    expect(correctionConfidence("that's not the pattern")).toBeLessThan(0.75);
  });
});

describe("extractCorrectionCandidate", () => {
  test("creates candidate for strong correction", () => {
    const cand = extractCorrectionCandidate(
      "always use canonical JSONL as the source of truth, never edit MEMORY.md directly",
      "2026-05-13",
      "/home/mel/project",
    );
    expect(cand).not.toBeNull();
    expect(cand!.confidence).toBeGreaterThanOrEqual(0.85);
    expect(cand!.source.type).toBe("user_correction");
    expect(cand!.tags).toContain("correction");
    expect(cand!.status).toBe("new");
  });

  test("returns null for below-threshold confidence", () => {
    const cand = extractCorrectionCandidate(
      "that could be better", // no real correction pattern
      "2026-05-13",
      "/home/mel/project",
    );
    expect(cand).toBeNull();
  });

  test("truncates very long correction text", () => {
    const longText = "always use X instead of Y. ".repeat(20);
    const cand = extractCorrectionCandidate(longText, "2026-05-13", "/home/mel");
    expect(cand).not.toBeNull();
    expect(cand!.text.length).toBeLessThanOrEqual(300);
  });
});
