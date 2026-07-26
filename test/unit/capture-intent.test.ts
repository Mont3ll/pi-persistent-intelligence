import { describe, expect, test } from "bun:test";
import { classifyCaptureIntent } from "../../src/capture-intent";

const preferences = [
  "Avoid em dashes entirely.",
  "I prefer plain punctuation in public writing.",
  "My preference is to keep headings in sentence case.",
  "When writing for me, avoid promotional language.",
  "For all my writing, use straight quotation marks.",
  "I do not like title case headings.",
];

describe("capture intent", () => {
  for (const text of preferences) {
    test(`captures user preference: ${text}`, () => {
      const result = classifyCaptureIntent(text);
      expect(result.intent).toBe("user_preference");
      expect(result.durability).toBe("long_term");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });
  }

  test("normalizes compact emdash spelling for applicability", () => {
    const result = classifyCaptureIntent("Alongside the humanizer, avoid emdashes in public documentation.");
    expect(result.intent).toBe("user_preference");
    expect(result.applicability).toContain("writing");
    expect(result.global_cues.length).toBeGreaterThan(0);
  });

  test("classifies project conventions", () => {
    const result = classifyCaptureIntent("This repository always uses Bun for tests.");
    expect(result.intent).toBe("project_convention");
    expect(result.durability).toBe("project");
  });

  test("classifies reusable workflow playbooks", () => {
    const result = classifyCaptureIntent("Before publishing, run the release audit and package dry-run.");
    expect(result.intent).toBe("workflow_playbook");
    expect(result.applicability).toContain("release");
  });

  test("routes temporary instructions away from durable memory", () => {
    const result = classifyCaptureIntent("For this response, avoid headings and keep it short.");
    expect(result.intent).toBe("temporary_instruction");
    expect(result.durability).toBe("task");
  });

  for (const text of [
    "The article says: Avoid em dashes entirely.",
    "The repository documentation recommends that users prefer Bun over npm.",
    "Task: You are a delegated subagent. Never edit files outside this task.",
    "This paragraph discusses preferences in technical writing.",
  ]) {
    test(`rejects non-user preference: ${text.slice(0, 35)}`, () => {
      expect(classifyCaptureIntent(text).intent).toBe("not_memory");
    });
  }
});
