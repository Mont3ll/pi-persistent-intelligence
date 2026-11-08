import { describe, expect, test } from "bun:test";
import { resolvePersistedSemanticUserTurn } from "../../src/semantic-host-capture";

const content = [{ type: "text", text: "For this project, always run the lapis check." }];
const message = (id: string, timestamp: number) => ({
  type: "message", id, message: { role: "user", timestamp, content },
});

describe("R4 production host source identity gate", () => {
  test("one genuine persisted entry supplies both exact id and original bytes", () => {
    const result = resolvePersistedSemanticUserTurn({
      getEntries: () => [message("persisted-A", 10)],
    }, { content });
    expect(result).toEqual({
      turnId: "persisted-A", text: "For this project, always run the lapis check.",
    });
  });

  test("missing session manager and fabricated runtime ID never become authority", () => {
    expect(resolvePersistedSemanticUserTurn(undefined, {
      id: "fabricated", content,
    })).toBeNull();
    expect(resolvePersistedSemanticUserTurn({ getEntries: () => [] }, {
      id: "fabricated", content,
    })).toBeNull();
  });

  test("two same-text persisted user turns require unambiguous id or time", () => {
    const entries = [message("A", 10), message("B", 20)];
    const manager = { getEntries: () => entries };
    expect(resolvePersistedSemanticUserTurn(manager, { content })).toBeNull();
    expect(resolvePersistedSemanticUserTurn(manager, {
      id: "B", content,
    })).toEqual({ turnId: "B", text: content[0]!.text });
    expect(resolvePersistedSemanticUserTurn(manager, {
      timestamp: 10, content,
    })).toEqual({ turnId: "A", text: content[0]!.text });
    expect(resolvePersistedSemanticUserTurn(manager, {
      id: "made-up", content,
    })).toBeNull();
  });

  test("assistant/third-party messages never stand in for original user entry", () => {
    expect(resolvePersistedSemanticUserTurn({
      getEntries: () => [
        { type: "message", id: "assistant", message: { role: "assistant", content } },
        { type: "message", id: "custom", message: { role: "user", customType: "tool-output", content } },
      ],
    }, { content })).toBeNull();
  });

  test("exact persisted multi-block text retains newlines, not runtime space-normalization", () => {
    const parts = [
      { type: "text", text: "Here is some context." },
      { type: "text", text: "Always verify the lapis release." },
    ];
    expect(resolvePersistedSemanticUserTurn({
      getEntries: () => [{ type: "message", id: "multi",
        message: { role: "user", content: parts } }],
    }, { content: parts })).toEqual({
      turnId: "multi", text: "Here is some context.\nAlways verify the lapis release.",
    });
  });
});
