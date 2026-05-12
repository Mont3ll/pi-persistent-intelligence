import { describe, expect, test } from "bun:test";
import { buildConsolidationPrompt, parseConsolidationResponse, applyConsolidation, CONSOLIDATION_PROMPT_TEMPLATE } from "../../src/consolidator";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { listCandidates } from "../../src/inbox";

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "pi-consolidator-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("buildConsolidationPrompt", () => {
  test("includes template header and message lines", () => {
    const prompt = buildConsolidationPrompt(["how do I search?", "use qmd"], ["try qmd search", "run qmd query"]);
    expect(prompt).toContain(CONSOLIDATION_PROMPT_TEMPLATE.slice(0, 50));
    expect(prompt).toContain("[User] how do I search?");
    expect(prompt).toContain("[Assistant] try qmd search");
  });

  test("caps at 60 messages", () => {
    const user = Array.from({ length: 80 }, (_, i) => `user msg ${i}`);
    const asst = Array.from({ length: 80 }, (_, i) => `asst msg ${i}`);
    const prompt = buildConsolidationPrompt(user, asst);
    // Should not contain very early messages (capped at last 60)
    expect(prompt).not.toContain("user msg 0\n");
    expect(prompt).toContain("user msg 79");
  });
});

describe("parseConsolidationResponse", () => {
  test("parses valid JSON response with candidates", () => {
    const raw = `Here is the extracted memory:
{"candidates": [
  {"statement": "Use bun not npm for this project", "tags": ["tooling"], "confidence": 0.9, "evidence_hint": "user corrected npm install to bun install"},
  {"statement": "Always run typecheck before committing", "tags": ["workflow"], "confidence": 0.85, "evidence_hint": "user asked to add typecheck step"}
]}`;
    const result = parseConsolidationResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].statement).toBe("Use bun not npm for this project");
    expect(result[0].confidence).toBe(0.9);
  });

  test("filters out low-confidence candidates", () => {
    const raw = `{"candidates": [
  {"statement": "Maybe use redis someday", "tags": ["idea"], "confidence": 0.4, "evidence_hint": "mentioned once"},
  {"statement": "Prefer conventional commits", "tags": ["git"], "confidence": 0.8, "evidence_hint": "user mentioned it"}
]}`;
    const result = parseConsolidationResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("Prefer conventional commits");
  });

  test("returns empty array for invalid JSON", () => {
    expect(parseConsolidationResponse("not json at all")).toEqual([]);
    expect(parseConsolidationResponse("")).toEqual([]);
    expect(parseConsolidationResponse('{"candidates": "not an array"}')).toEqual([]);
  });

  test("handles JSON embedded in prose", () => {
    const raw = `Okay here you go: {"candidates": [{"statement": "Use patch files first", "tags": ["memory"], "confidence": 0.85, "evidence_hint": "recurring pattern"}]} done.`;
    const result = parseConsolidationResponse(raw);
    expect(result).toHaveLength(1);
  });
});

describe("applyConsolidation", () => {
  test("adds candidates to inbox", () => {
    const { dir, cleanup } = tempRoot();
    ensureMemoryDirs(dir);
    const candidates = [
      { statement: "Use bun test for unit tests", tags: ["testing"], confidence: 0.85, evidence_hint: "used consistently" },
      { statement: "Write types before implementation", tags: ["workflow"], confidence: 0.9, evidence_hint: "user mentioned" },
    ];
    const result = applyConsolidation(dir, candidates, "2026-05-12", dir);
    expect(result.candidates_extracted).toBe(2);
    expect(result.candidates_added).toBe(2);
    const inbox = listCandidates(dir);
    expect(inbox).toHaveLength(2);
    expect(inbox[0].status).toBe("new");
    expect(inbox[0].source.type).toBe("conversation");
    cleanup();
  });

  test("returns zero counts for empty candidates", () => {
    const { dir, cleanup } = tempRoot();
    ensureMemoryDirs(dir);
    const result = applyConsolidation(dir, [], "2026-05-12", dir);
    expect(result.candidates_extracted).toBe(0);
    expect(result.candidates_added).toBe(0);
    cleanup();
  });
});
