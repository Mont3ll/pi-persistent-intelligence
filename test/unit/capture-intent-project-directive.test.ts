import { describe, expect, test } from "bun:test";
import { classifyCaptureIntent } from "../../src/capture-intent";

describe("project-scoped durable imperative capture", () => {
  for (const text of [
    "For this project, always use YAML for acceptance fixture manifests going forward.",
    "For this project, use TOML for rejection-fixture manifests going forward.",
  ]) {
    test(`captures project-scoped durable directive: ${text}`, () => {
      const result = classifyCaptureIntent(text);
      expect(result.intent).toBe("project_convention");
      expect(result.durability).toBe("project");
      expect(result.project_cues.length).toBeGreaterThan(0);
    });
  }

  test("does not promote task-scoped imperative with similar wording", () => {
    const result = classifyCaptureIntent(
      "For this task, always use YAML for the acceptance fixture and stop after the report.",
    );
    expect(result.intent).toBe("temporary_instruction");
    expect(result.durability).toBe("task");
  });
});
