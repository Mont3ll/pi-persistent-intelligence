import { describe, expect, test } from "bun:test";
import { assessOriginalTurnAutoEligibility, classifyCaptureIntent } from "../../src/capture-intent";
import { scoreMemoryWorth } from "../../src/memory-worth";
import { hasExplicitTaskOnlyScope } from "../../src/temporary-scope";

describe("R4 temporal qualifier grammar symmetry", () => {
  test("leading and trailing only share prepositions, determiners, modifiers and temporal units", () => {
    let checked = 0;
    for (const preposition of ["for", "in", "during", "within"]) {
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
    expect(checked).toBe(576);
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

  test("a temporal restriction can end at a clause separator, not only sentence end", () => {
    for (const suffix of [
      "only within the current trial, then return to the normal workflow.",
      "within this test only; not as a standing rule.",
      "only for the current test and not for subsequent tests.",
      "within the current trial only because this is a one-off exercise.",
    ]) {
      const message = "For this project, always verify the sapphire manifest " + suffix;
      expect(hasExplicitTaskOnlyScope(message)).toBe(true);
      expect(classifyCaptureIntent(message).durability).toBe("task");
      expect(assessOriginalTurnAutoEligibility(message).eligible).toBe(false);
    }
  });

  test("purpose and expiry task-limits hold independently of memory-worth scoring", () => {
    let checked = 0;
    for (const determiner of ["this", "the", "current", "the current"]) {
      for (const unit of ["test", "trial", "exercise", "experiment"]) {
        const period = determiner + " " + unit;
        const variants = [
          "for " + period + " only to collect diagnostics",
          "only within " + period + " to validate this experiment",
          "for the duration of " + period,
          "until " + period + " ends",
          "until " + period + " is over",
          "until the end of " + period,
        ];
        for (const suffix of variants) {
          const text = "For this project, always run the sapphire audit " + suffix + ".";
          expect(hasExplicitTaskOnlyScope(text)).toBe(true);
          expect(classifyCaptureIntent(text).intent).toBe("temporary_instruction");
          expect(assessOriginalTurnAutoEligibility(text).eligible).toBe(false);
          const worth = scoreMemoryWorth({
            observation: text, explicitUserRequest: true, recurrenceCount: 5,
            operationalImpact: 1, evidenceStrength: 1,
            durability: "project", scope: "project",
          });
          expect(worth.decision).toBe("daily_only");
          checked++;
        }
      }
    }
    expect(checked).toBe(96);
  });

  test("duration mentions and expiry conditions in lasting workflows are not one-off scope", () => {
    const controls = [
      "For this project, always collect diagnostics for the current test suite.",
      "For this project, always validate the current experiment results.",
      "For this project, always run the audit until all checks pass before publication.",
      "For this project, always read the trial duration report.",
      "For this project, always document when the current trial ends.",
      "For this project, always run audits for the duration of the current trial results.",
    ];
    for (const text of controls) {
      expect(hasExplicitTaskOnlyScope(text)).toBe(false);
      expect(scoreMemoryWorth({ observation: text, explicitUserRequest: true,
        scope: "project", durability: "project" }).reasons).not.toContain("explicit_task_only_scope");
    }
  });

  test("qualifiers must be bounded by a temporary unit and an explicit only marker", () => {
    for (const phrase of [
      "for this test results", "only for this testing convention",
      "within the current test results", "only within the current test suite",
      "only within the current trial results", "within the current test suite only verified",
      "only during the current release process",
      "in the current test artifacts", "for this one test suite",
    ]) {
      expect(hasExplicitTaskOnlyScope("For this project, always verify manifests " + phrase + ".")).toBe(false);
    }
  });
});
