import { describe, expect, test } from "bun:test";
import { assessOriginalTurnAutoEligibility, classifyCaptureIntent } from "../../src/capture-intent";
import { scoreMemoryWorth } from "../../src/memory-worth";
import { hasExplicitTaskOnlyScope } from "../../src/temporary-scope";

describe("R4 temporal qualifier grammar symmetry", () => {
  test("leading and trailing only share prepositions, determiners, modifiers and temporal units", () => {
    let checked = 0;
    for (const preposition of ["for", "in", "during"]) {
      for (const determiner of ["this", "the", "current", "the current"]) {
        for (const modifier of ["", "one ", "single "]) {
          for (const unit of ["test", "trial", "test run", "exercise"]) {
            const period = [determiner, modifier + unit].join(" ");
            const endings = [
              preposition + " " + period + " only",
              "only " + preposition + " " + period,
              "just " + preposition + " " + period,
            ];
            for (const ending of endings) {
              const message = "For this project, always run the sapphire release audit " + ending + ".";
              if (!hasExplicitTaskOnlyScope(message)) throw new Error("Missed temporary qualifier: " + ending);
              const intent = classifyCaptureIntent(message);
              expect(intent.intent).toBe("temporary_instruction");
              expect(intent.durability).toBe("task");
              expect(intent.reasons).toContain("explicit_task_only_scope");
              expect(assessOriginalTurnAutoEligibility(message)).toEqual({
                eligible: false, reason: "explicit_task_only_scope",
              });
              const worth = scoreMemoryWorth({
                observation: message, explicitUserRequest: true, recurrenceCount: 5,
                operationalImpact: 1, evidenceStrength: 1, scope: "project",
                durability: "project",
              });
              expect(worth.decision).toBe("daily_only");
              expect(worth.reasons).toContain("explicit_task_only_scope");
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBe(432);
  });

  test("persistent project testing conventions are not marked task-only", () => {
    const controls = [
      "For this project, always run the sapphire release audit before publishing.",
      "For this project, always run the sapphire release audit for every test.",
      "This repository always verifies the current test results before publishing.",
      "For this project, always run Bun tests after changing source.",
      "For this project, always review the results of this one test before approval.",
    ];
    for (const message of controls) {
      expect(hasExplicitTaskOnlyScope(message)).toBe(false);
      expect(classifyCaptureIntent(message).intent).not.toBe("temporary_instruction");
      expect(scoreMemoryWorth({ observation: message, explicitUserRequest: true,
        durability: "project", scope: "project" }).reasons).not.toContain("explicit_task_only_scope");
    }
  });

  test("qualifiers must be bounded by a temporary unit and an explicit only marker", () => {
    for (const phrase of [
      "for this test results", "only for this testing convention",
      "only during the current release process",
      "in the current test artifacts", "for this one test suite",
    ]) {
      expect(hasExplicitTaskOnlyScope("For this project, always verify manifests " + phrase + ".")).toBe(false);
    }
  });
});
