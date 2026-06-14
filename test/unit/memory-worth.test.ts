import { describe, expect, test } from "bun:test";
import { scoreMemoryWorth } from "../../src/memory-worth";

describe("memory-worth scoring", () => {
  test("rejects trivial observations", () => {
    const decision = scoreMemoryWorth({ observation: "ok thanks", existingStatements: [] });
    expect(decision.decision).toBe("reject");
    expect(decision.reasons).toContain("trivial_or_low_information");
  });

  test("explicit correction becomes candidate", () => {
    const decision = scoreMemoryWorth({ observation: "Going forward, do not use npm here; use bun test.", explicitUserRequest: true });
    expect(decision.decision).toBe("candidate");
    expect(decision.signals.correction_strength).toBeGreaterThan(0.7);
  });

  test("vague high-impact observation becomes inquiry", () => {
    const decision = scoreMemoryWorth({ observation: "The deployment process is critical but unclear.", operationalImpact: 0.95 });
    expect(decision.decision).toBe("inquiry");
    expect(decision.reasons).toContain("important_but_underspecified");
  });

  test("temporary update becomes daily-only", () => {
    const decision = scoreMemoryWorth({ observation: "Today we are waiting for npm indexing to finish.", durability: "temporary" });
    expect(decision.decision).toBe("daily_only");
  });

  test("duplicate observation receives low score", () => {
    const decision = scoreMemoryWorth({ observation: "Use bun test before committing.", existingStatements: ["Use bun test before committing."] });
    expect(decision.decision).toBe("reject");
    expect(decision.reasons).toContain("already_represented");
  });

  test("sensitive observation without explicit request is rejected or inquiry gated", () => {
    const decision = scoreMemoryWorth({ observation: "The API key is sk-proj-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" });
    expect(["reject", "inquiry"]).toContain(decision.decision);
    expect(decision.signals.sensitivity_risk).toBeGreaterThan(0.8);
  });

  test("high-confidence repeated workflow becomes candidate", () => {
    const decision = scoreMemoryWorth({ observation: "Always run bun test and bun run typecheck before committing.", recurrenceCount: 3, operationalImpact: 0.8, evidenceStrength: 0.9, scope: "project" });
    expect(decision.decision).toBe("candidate");
    expect(decision.worth_score).toBeGreaterThanOrEqual(0.7);
  });
});
