import { describe, expect, test } from "bun:test";
import { buildDailyDigest } from "../../src/retriever";

describe("buildDailyDigest", () => {
  test("extracts #decision lines and ## headings", () => {
    const log = `<!-- 2026-05-12T10:00:00Z -->
## Session notes
- Used bun install for dependencies
- #decision switched to custom message injection for KV-cache

<!-- 2026-05-12T11:00:00Z -->
## Session ended
- Persistent Intelligence captured session end marker.`;

    const digest = buildDailyDigest(log, 2000);
    expect(digest).toContain("#decision");
    expect(digest).toContain("custom message injection");
    // Should not include boilerplate
    expect(digest).not.toContain("Persistent Intelligence captured session end marker");
  });

  test("counts session markers", () => {
    const log = `## Session ended
- Persistent Intelligence captured session end marker.

## Session ended
- Persistent Intelligence captured session end marker.`;
    const digest = buildDailyDigest(log, 2000);
    expect(digest).toContain("Sessions today: 2");
  });

  test("falls back to raw tail when no structured content", () => {
    const log = "some raw content without any headings or decisions";
    const digest = buildDailyDigest(log, 2000);
    expect(digest).toBe(log);
  });

  test("respects maxChars limit", () => {
    const longContent = "- item\n".repeat(500);
    const log = `## Notes\n${longContent}`;
    const digest = buildDailyDigest(log, 100);
    expect(digest.length).toBeLessThanOrEqual(120); // some tolerance for truncation marker
  });

  test("returns empty string for empty log", () => {
    expect(buildDailyDigest("", 2000)).toBe("");
    expect(buildDailyDigest("   \n  ", 2000)).toBe("");
  });
});
