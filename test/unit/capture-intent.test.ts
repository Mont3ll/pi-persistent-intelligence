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
    "Proceed with the formal v0.17.0 release closure. Do not begin v0.18 work during this task.",
    "GaragePro Task 0 BaseModal hardening handoff. This slice is only Task 0. Do not begin Task 7.",
    "Continue the two approved bounded PI fixes. This is implementation and verification work only. Do not merge, release or publish.",
    "Verify the RED stage for issue #20. Do not edit production code. Do not implement the fix. Do not tag or publish.",
    "Do not rerun the PI curation audit. Do not invoke PI. Use only the already-created audit artifacts.",
    "Resume the consolidation-evidence provenance verification from a fresh detached worktree. The previous typecheck failure was corrected by a test-only commit. Do not reuse the old verification worktree. Do not mutate the live PI store. Do not modify the divergent configured checkout.",
    "Verify the final consolidation-evidence provenance head after secondary-review corrections. Do not modify source. Do not mutate the live PI store. Do not modify the divergent configured checkout. Do not create a PR.",
  ]) {
    test(`routes task-bound operational instruction to daily-only: ${text.slice(0, 38)}`, () => {
      const result = classifyCaptureIntent(text);
      expect(result.intent).toBe("temporary_instruction");
      expect(result.durability).toBe("task");
    });
  }

  for (const text of [
    "Verify the GREEN implementation for the fresh task-bound capture pollution defects. Do not modify source. Do not mutate the live PI store. Do not modify the divergent configured checkout. False-positive control: Going forward, do not merge, release, or publish unless I explicitly authorize it. Stop after the report.",
    "Resume verification of the capture task-wrapper integrity fix at the new exact SHA. Do not modify source. Do not mutate the live PI store. Do not create a PR. Durable-control fixture: Going forward, do not merge, release, or publish unless I explicitly authorize it. Stop after the report.",
  ]) {
    test(`keeps verifier handoff task-bound when durable cues appear only in embedded fixtures: ${text.slice(0, 38)}`, () => {
      const result = classifyCaptureIntent(text);
      expect(result.intent).toBe("temporary_instruction");
      expect(result.durability).toBe("task");
    });
  }

  for (const text of [
    "Verify the GREEN implementation for the task-bound capture fix. Do not modify source. Do not mutate the live PI store. Do not create a PR. False-positive controls: Going forward, do not merge without explicit authorization. Expected classification: behavior_correction/project. Stop after the report.",
    "Resume verification at the exact SHA. Do not modify source. Do not mutate the live PI store. Do not modify the configured checkout. Also confirm the durable control still behaves correctly: Going forward, do not merge, release, or publish unless explicitly authorized. Expected classification: behavior_correction/project. Stop after the report.",
  ]) {
    test(`keeps historical verifier section shapes task-bound after task constraints: ${text.slice(0, 38)}`, () => {
      const result = classifyCaptureIntent(text);
      expect(result.intent).toBe("temporary_instruction");
      expect(result.durability).toBe("task");
    });
  }

  test("keeps complete-release handoffs task-bound", () => {
    const result = classifyCaptureIntent(
      "Complete the final verification and release of pi-persistent-intelligence v0.17.3 from the post-documentation merged main commit. This supersedes all earlier v0.17.3 publication prompts. The release must be based only on the exact commit below. Do not mutate the live PI canonical store. Stop immediately on any failed invariant.",
    );
    expect(result.intent).toBe("temporary_instruction");
    expect(result.durability).toBe("task");
  });

  test("preserves top-level durable correction in a complete-release handoff", () => {
    const result = classifyCaptureIntent(
      "Complete the release verification. Going forward, do not publish without explicit authorization. Do not bypass the release audit.",
    );
    expect(result.intent).toBe("behavior_correction");
    expect(result.durability).toBe("project");
  });

  test("preserves top-level durable corrections inside verifier-shaped messages", () => {
    const result = classifyCaptureIntent(
      "Verify this repository test setup before continuing. Going forward, do not merge or publish without explicit authorization. Do not use npm for this project. Do not bypass the release checks.",
    );
    expect(result.intent).toBe("behavior_correction");
    expect(result.durability).toBe("project");
  });

  test("preserves explicit durable release boundaries", () => {
    const result = classifyCaptureIntent("Going forward, do not merge, release, or publish unless I explicitly authorize it.");
    expect(result.intent).toBe("behavior_correction");
    expect(result.durability).toBe("project");
  });

  test("preserves durable resume-using corrections", () => {
    const result = classifyCaptureIntent("Resume using Bun for this project going forward.");
    expect(result.intent).toBe("behavior_correction");
    expect(result.durability).toBe("project");
  });

  for (const text of [
    "The article says: Avoid em dashes entirely.",
    "The repository documentation recommends that users prefer Bun over npm.",
    "Task: You are a delegated subagent. Never edit files outside this task.",
    "This paragraph discusses preferences in technical writing.",
    '<skill name="graphify" location="/tmp/skills/graphify/SKILL.md">Before committing, always run graph checks.</skill>',
    '<skill location="/tmp/skills/release/SKILL.md">Always run release-audit before publishing.</skill>',
  ]) {
    test(`rejects non-user preference: ${text.slice(0, 35)}`, () => {
      expect(classifyCaptureIntent(text).intent).toBe("not_memory");
    });
  }
});
