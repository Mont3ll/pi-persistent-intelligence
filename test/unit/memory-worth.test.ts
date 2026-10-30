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

  for (const observation of [
    "For this project, always run the sapphire release audit for this test only; this is a one-off instruction.",
    "For this repository, always verify release manifests in this test only; this is a single-use instruction.",
    "For this project, always run the sapphire release audit just for this exercise.",
  ]) {
    test("explicitly test-only scope outweighs a high durable score: " + observation.slice(-35), () => {
      const decision = scoreMemoryWorth({
        observation, explicitUserRequest: true, recurrenceCount: 3,
        operationalImpact: 1, evidenceStrength: 1, durability: "project",
        scope: "project",
      });
      expect(decision.decision).toBe("daily_only");
      expect(decision.reasons).toContain("explicit_task_only_scope");
      expect(decision.reasons).toContain("temporary_or_ephemeral");
      expect(decision.signals.future_reuse_likelihood).toBe(0.2);
    });
  }

  test("permanent testing conventions remain durable rather than task-only", () => {
    const decision = scoreMemoryWorth({
      observation: "For this project, always run Bun tests before each release.",
      explicitUserRequest: true, durability: "project", scope: "project",
    });
    expect(decision.decision).toBe("candidate");
    expect(decision.reasons).not.toContain("explicit_task_only_scope");
  });

  test("high-confidence repeated workflow becomes candidate", () => {
    const decision = scoreMemoryWorth({ observation: "Always run bun test and bun run typecheck before committing.", recurrenceCount: 3, operationalImpact: 0.8, evidenceStrength: 0.9, scope: "project" });
    expect(decision.decision).toBe("candidate");
    expect(decision.worth_score).toBeGreaterThanOrEqual(0.7);
  });
});
