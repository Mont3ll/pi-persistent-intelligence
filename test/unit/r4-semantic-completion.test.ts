import { describe, expect, test } from "bun:test";
import {
  assertSuccessfulSemanticCompletion,
  type SemanticSessionState,
} from "../../src/semantic-completion";

// JSON deliberately remains parseable for every negative case: completion
// state, not text syntax, determines whether the output is admissible.
const plausibleJson = '{"version":1,"outcome":"proposed","propositions":[]}';
const completed: SemanticSessionState = {
  messages: [{ role: "user" }, { role: "assistant", stopReason: "stop" }],
  isStreaming: false,
};

describe("R4 Pi semantic completion before JSON acceptance", () => {
  test("a finished assistant turn is accepted only with stopReason stop", () => {
    expect(() => assertSuccessfulSemanticCompletion(completed, false)).not.toThrow();
    expect(JSON.parse(plausibleJson)).toHaveProperty("outcome", "proposed");
  });

  for (const stopReason of [
    "aborted", "error", "length", "toolUse", "pending", "deferred", undefined,
  ]) {
    test("refuses buffered valid JSON from nonfinal " + String(stopReason), () => {
      expect(() => assertSuccessfulSemanticCompletion({
        messages: [{ role: "user" }, { role: "assistant", stopReason }],
      }, false)).toThrow("semantic_assessment_incomplete");
    });
  }

  test("a timed-out run is rejected even if SDK reports stop afterward", () => {
    expect(() => assertSuccessfulSemanticCompletion(completed, true))
      .toThrow("semantic_assessment_deadline_exceeded");
  });

  test("SDK error, trailing non-assistant messages and streaming state abstain", () => {
    for (const state of [
      { messages: completed.messages, errorMessage: "aborted" },
      { messages: [{ role: "assistant", stopReason: "stop", errorMessage: "transport_error" }] },
      { messages: [...completed.messages, { role: "toolResult" }] },
      { messages: completed.messages, isStreaming: true },
      { messages: [] },
    ]) {
      expect(() => assertSuccessfulSemanticCompletion(state, false))
        .toThrow("semantic_assessment_incomplete");
    }
  });
});
