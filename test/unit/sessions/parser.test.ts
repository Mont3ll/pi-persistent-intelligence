import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSession, discoverSessionFiles, slugToProject, readSessionConversation } from "../../../src/sessions/parser";

let tempDirs: string[] = [];
function tempDir() {
  const dir = join(tmpdir(), `pi-parser-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
  tempDirs = [];
});

function makeSession(dir: string, entries: object[]): string {
  const file = join(dir, "2026-05-12T10-00-00-000Z_test-id.jsonl");
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
  return file;
}

const HEADER = { type: "session", version: 3, id: "test-session-uuid", timestamp: "2026-05-12T10:00:00.000Z", cwd: "/home/mel/projects/foo" };
const USER_MSG = (text: string, ts = "2026-05-12T10:01:00.000Z") => ({
  type: "message", id: "aa1", parentId: null, timestamp: ts,
  message: { role: "user", content: text, timestamp: Date.now() }
});
const ASSISTANT_MSG = (text: string) => ({
  type: "message", id: "bb2", parentId: "aa1", timestamp: "2026-05-12T10:02:00.000Z",
  message: { role: "assistant", content: [{ type: "text", text }], provider: "anthropic", model: "claude-sonnet", usage: { cost: { total: 0.01 }, totalTokens: 100 }, timestamp: Date.now() }
});
const TOOL_RESULT = (toolName: string, path?: string) => ({
  type: "message", id: "cc3", parentId: "bb2", timestamp: "2026-05-12T10:03:00.000Z",
  message: { role: "toolResult", toolCallId: "t1", toolName, content: [{ type: "text", text: "ok" }], isError: false, details: path ? { path } : undefined }
});

describe("slugToProject", () => {
  test("extracts last meaningful segment", () => {
    expect(slugToProject("--home-mel-Documents-Projects-foo--")).toBe("foo");
    expect(slugToProject("--home-mel--")).toBe("mel");
  });

  test("handles non-slug strings", () => {
    expect(slugToProject("unknown")).toBe("unknown");
  });
});

describe("parseSession", () => {
  test("extracts header fields", () => {
    const dir = tempDir();
    const file = makeSession(dir, [HEADER, USER_MSG("hello world")]);
    const parsed = parseSession(file, false);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe("test-session-uuid");
    expect(parsed!.cwd).toBe("/home/mel/projects/foo");
    expect(parsed!.date).toBe("2026-05-12");
    expect(parsed!.archived).toBe(false);
  });

  test("extracts user messages", () => {
    const dir = tempDir();
    const file = makeSession(dir, [HEADER, USER_MSG("first message"), USER_MSG("second message")]);
    const parsed = parseSession(file, false);
    expect(parsed!.userMessages).toContain("first message");
    expect(parsed!.userMessages).toContain("second message");
    expect(parsed!.userMessageCount).toBe(2);
  });

  test("extracts #decision markers", () => {
    const dir = tempDir();
    const file = makeSession(dir, [HEADER, USER_MSG("#decision use patch files before mutation")]);
    const parsed = parseSession(file, false);
    expect(parsed!.decisions).toHaveLength(1);
    expect(parsed!.decisions[0]).toContain("#decision");
  });

  test("tracks modified files from tool results", () => {
    const dir = tempDir();
    const file = makeSession(dir, [HEADER, USER_MSG("edit file"), ASSISTANT_MSG("editing"), TOOL_RESULT("edit", "/src/foo.ts")]);
    const parsed = parseSession(file, false);
    expect(parsed!.filesModified).toContain("/src/foo.ts");
  });

  test("returns null for missing header", () => {
    const dir = tempDir();
    const file = makeSession(dir, [USER_MSG("no header")]);
    expect(parseSession(file, false)).toBeNull();
  });

  test("extracts assistant text and models", () => {
    const dir = tempDir();
    const file = makeSession(dir, [HEADER, USER_MSG("q"), ASSISTANT_MSG("long answer about patches")]);
    const parsed = parseSession(file, false);
    expect(parsed!.assistantText).toContain("long answer about patches");
    expect(parsed!.models).toContain("anthropic/claude-sonnet");
  });
});

describe("readSessionConversation", () => {
  test("formats user and assistant messages", () => {
    const dir = tempDir();
    const file = makeSession(dir, [HEADER, USER_MSG("what is memory governance?"), ASSISTANT_MSG("Memory governance means...")]);
    const output = readSessionConversation(file);
    expect(output).toContain("USER");
    expect(output).toContain("what is memory governance?");
    expect(output).toContain("ASSISTANT");
    expect(output).toContain("Memory governance means...");
  });
});
