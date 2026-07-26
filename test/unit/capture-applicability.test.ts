import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectTaskCategories, matchesPositiveApplicability } from "../../src/capture-applicability";
import { buildRetrievalContext } from "../../src/retriever";
import { unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord, SessionContext } from "../../src/types";

const dirs: string[] = [];
function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-applicability-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

function writingPreference(): MemoryRecord {
  return {
    id: "writing-pref",
    layer: "L2",
    scope: { type: "global" },
    tags: ["writing", "preference"],
    statement: "Avoid em dashes in public-facing writing.",
    evidence: [{ type: "manual", ref: "test", note: "test" }],
    confidence: 0.9,
    stability: "stable",
    created_at: "2026-07-26",
    updated_at: "2026-07-26",
    review: { cadence_days: 30, next_review: "2026-08-25", change_condition: "user changes preference" },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ruleType: "avoid_pattern",
    applies_when: ["writing", "documentation", "LinkedIn", "portfolio", "application"],
  };
}

function context(prompt: string): SessionContext {
  return { resource_id: "u", profile_id: "p", working_directory: "/repo", latest_user_message: prompt, recent_files_touched: [], detected_domain_tags: detectTaskCategories(prompt, []), is_trivial_prompt: false };
}

describe("capture applicability", () => {
  test("detects bounded task categories", () => {
    expect(detectTaskCategories("Rewrite my LinkedIn profile and portfolio summary.", [])).toContain("writing");
    expect(detectTaskCategories("Run cargo test and clippy before release.", [])).toEqual(expect.arrayContaining(["testing", "release"]));
    expect(detectTaskCategories("hello", [])).toEqual([]);
  });

  test("matches positive applicability only in relevant context", () => {
    expect(matchesPositiveApplicability(writingPreference(), context("Rewrite my LinkedIn profile."))).toBe(true);
    expect(matchesPositiveApplicability(writingPreference(), context("Debug the cargo store test."))).toBe(false);
  });

  test("injects writing preference for LinkedIn editing", async () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, writingPreference());
    const result = await buildRetrievalContext(dir, { prompt: "Rewrite my LinkedIn profile summary for a hackathon application.", today: "2026-07-26" });
    expect(result.markdown).toContain("Avoid em dashes");
  });

  test("keeps writing preference out of unrelated cargo debugging", async () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, writingPreference());
    const result = await buildRetrievalContext(dir, { prompt: "Debug the failing cargo test in the store crate.", today: "2026-07-26" });
    expect(result.markdown).not.toContain("Avoid em dashes");
  });

  test("keeps the existing total context cap", async () => {
    const dir = root();
    unsafeAddMemoryRecord(dir, writingPreference());
    const result = await buildRetrievalContext(dir, { prompt: "Rewrite documentation ".repeat(100), today: "2026-07-26" });
    expect(result.markdown.length).toBeLessThanOrEqual(14_000);
  });
});
