import { describe, expect, test } from "bun:test";
import { InboxReviewOverlay, buildInboxNotification, themeFromInbox } from "../../src/tui/InboxReviewOverlay";
import type { CaptureCandidate } from "../../src/types";

function candidate(id: string, confidence: number, text = "test pattern"): CaptureCandidate {
  return {
    id,
    created_at: new Date().toISOString(),
    source: { type: "manual", ref: "daily/2026-05-12.md" },
    text,
    tags: ["workflow"],
    evidence_refs: ["daily/2026-05-12.md", "docs/spec.md"],
    confidence,
    status: "new",
  };
}

describe("InboxReviewOverlay", () => {
  const candidates = [
    candidate("cap_1", 0.92, "Use bun not npm"),
    candidate("cap_2", 0.87, "Always write tests first"),
    candidate("cap_3", 0.78, "Consider Redis for caching"),
  ];

  test("renders header with candidate count", () => {
    let result: string | null = null;
    const overlay = new InboxReviewOverlay(
      { candidates, autoEligibleCount: 2, highThreshold: 0.85 },
      themeFromInbox(undefined),
      (action) => { result = action; },
    );
    const lines = overlay.render(80);
    const text = lines.join("\n");
    expect(text).toContain("Memory Inbox");
    expect(text).toContain("3 candidate");
  });

  test("renders candidates with confidence and statement", () => {
    const overlay = new InboxReviewOverlay(
      { candidates, autoEligibleCount: 2, highThreshold: 0.85 },
      themeFromInbox(undefined),
      () => {},
    );
    const lines = overlay.render(80);
    const text = lines.join("\n");
    expect(text).toContain("0.92");
    expect(text).toContain("Use bun not npm");
    expect(text).toContain("0.78");
  });

  test("shows auto-eligible badge ✓ for high confidence", () => {
    const overlay = new InboxReviewOverlay(
      { candidates, autoEligibleCount: 2, highThreshold: 0.85 },
      themeFromInbox(undefined),
      () => {},
    );
    const text = overlay.render(80).join("\n");
    expect(text).toContain("✓"); // 0.92 and 0.87 both ≥ 0.85
    expect(text).toContain("~"); // 0.78 < 0.85
  });

  test("escape / 'q' calls done with null", () => {
    let result: string | undefined = "not-set";
    const overlay = new InboxReviewOverlay(
      { candidates, autoEligibleCount: 2, highThreshold: 0.85 },
      themeFromInbox(undefined),
      (action) => { result = action ?? "null"; },
    );
    overlay.handleInput("\u001b"); // escape
    expect(result).toBe("null");
  });

  test("'a' calls done with approve", () => {
    let result: string | undefined;
    const overlay = new InboxReviewOverlay(
      { candidates, autoEligibleCount: 2, highThreshold: 0.85 },
      themeFromInbox(undefined),
      (action) => { result = action ?? "null"; },
    );
    overlay.handleInput("a");
    expect(result).toBe("approve");
  });

  test("'r' calls done with review", () => {
    let result: string | undefined;
    const overlay = new InboxReviewOverlay(
      { candidates, autoEligibleCount: 2, highThreshold: 0.85 },
      themeFromInbox(undefined),
      (action) => { result = action ?? "null"; },
    );
    overlay.handleInput("r");
    expect(result).toBe("review");
  });

  test("'s' calls done with skip", () => {
    let result: string | undefined;
    const overlay = new InboxReviewOverlay(
      { candidates, autoEligibleCount: 2, highThreshold: 0.85 },
      themeFromInbox(undefined),
      (action) => { result = action ?? "null"; },
    );
    overlay.handleInput("s");
    expect(result).toBe("skip");
  });

  test("arrow navigation updates selection then Enter confirms", () => {
    let result: string | undefined;
    const overlay = new InboxReviewOverlay(
      { candidates, autoEligibleCount: 2, highThreshold: 0.85 },
      themeFromInbox(undefined),
      (action) => { result = action ?? "null"; },
    );
    // Initial selection is 0 (approve). Move right to review (1).
    overlay.handleInput("\u001b[C"); // right arrow
    overlay.handleInput("\r");       // enter
    expect(result).toBe("review");
  });

  test("truncates long candidate list to 6 with overflow indicator", () => {
    const many = Array.from({ length: 9 }, (_, i) => candidate(`cap_${i}`, 0.8, `Pattern ${i}`));
    const overlay = new InboxReviewOverlay(
      { candidates: many, autoEligibleCount: 0, highThreshold: 0.85 },
      themeFromInbox(undefined),
      () => {},
    );
    const text = overlay.render(80).join("\n");
    expect(text).toContain("2 more");
  });
});

describe("buildInboxNotification", () => {
  test("formats plain text fallback correctly", () => {
    const testCandidates = [
      candidate("cap_1", 0.92, "test 1"),
      candidate("cap_2", 0.87, "test 2"),
      candidate("cap_3", 0.78, "test 3"),
    ];
    const msg = buildInboxNotification(testCandidates, 2);
    expect(msg).toContain("3 memory candidates");
    expect(msg).toContain("2 auto-eligible");
    expect(msg).toContain("/curate-memory");
  });
});
