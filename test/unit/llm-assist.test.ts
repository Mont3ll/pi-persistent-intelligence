import { describe, expect, test } from "bun:test";
import { getLlmAssistPlan } from "../../src/llmAssist";

describe("LLM assistance guard", () => {
  test("is disabled unless explicitly configured", () => {
    expect(getLlmAssistPlan({ enabled: false, model: null }).enabled).toBe(false);
  });

  test("requires a model when enabled", () => {
    expect(() => getLlmAssistPlan({ enabled: true, model: null })).toThrow("LLM assistance requires config.llm.model");
  });

  test("returns configured model without invoking it", () => {
    const plan = getLlmAssistPlan({ enabled: true, model: "provider/model", instructions: "curate carefully" });
    expect(plan).toEqual({ enabled: true, model: "provider/model", instructions: "curate carefully" });
  });
});
