import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch } from "../../src/patch";
import { curateInbox } from "../../src/curator";
import { readEvidenceRecords } from "../../src/evidence";
import { ensureMemoryDirs } from "../../src/paths";
import { loadActiveRecords } from "../../src/store";
import { listCandidates } from "../../src/inbox";
import { readOpenInquiries } from "../../src/inquiries";
import { buildConsolidationPrompt, parseConsolidationResponse, applyConsolidation, runConsolidation, buildConsolidationCommandArgs, CONSOLIDATION_PROMPT_TEMPLATE } from "../../src/consolidator";

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "pi-consolidator-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function supportedCandidate(statement: string, messageIndex = 0, tags: string[] = ["workflow"], confidence = 0.9) {
  return {
    statement,
    tags,
    confidence,
    evidence: [{ message_index: messageIndex, quote: statement }],
  };
}

describe("buildConsolidationPrompt", () => {
  test("numbers user-authored messages and excludes assistant-authored text", () => {
    const prompt = buildConsolidationPrompt(["how do I search?", "use qmd"], ["try qmd search", "always commit before handoff"]);
    expect(prompt).toContain(CONSOLIDATION_PROMPT_TEMPLATE.slice(0, 50));
    expect(prompt).toContain("[User 0] how do I search?");
    expect(prompt).toContain("[User 1] use qmd");
    expect(prompt).not.toContain("[Assistant]");
    expect(prompt).not.toContain("try qmd search");
    expect(prompt).not.toContain("always commit before handoff");
    expect(prompt).toContain("quote must be copied from that exact user message");
  });

  test("caps at 60 user messages and reindexes the displayed window", () => {
    const user = Array.from({ length: 80 }, (_, i) => `user msg ${i}`);
    const asst = Array.from({ length: 80 }, (_, i) => `asst msg ${i}`);
    const prompt = buildConsolidationPrompt(user, asst);
    expect(prompt).not.toContain("user msg 0\n");
    expect(prompt).toContain("[User 0] user msg 20");
    expect(prompt).toContain("[User 59] user msg 79");
    expect(prompt).not.toContain("asst msg 79");
  });
});

describe("parseConsolidationResponse", () => {
  test("parses candidates with structured user-message evidence", () => {
    const raw = `Here is the extracted memory:\n{"candidates": [
  {"statement": "Use bun not npm for this project", "tags": ["tooling"], "confidence": 0.9, "evidence": [{"message_index": 0, "quote": "Use bun not npm for this project"}]},
  {"statement": "Always run typecheck before committing", "tags": ["workflow"], "confidence": 0.85, "evidence": [{"message_index": 2, "quote": "Always run typecheck before committing"}]}
]}`;
    const result = parseConsolidationResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].statement).toBe("Use bun not npm for this project");
    expect(result[0].confidence).toBe(0.9);
    expect(result[0].evidence).toEqual([{ message_index: 0, quote: "Use bun not npm for this project" }]);
  });

  test("filters out low-confidence candidates", () => {
    const raw = `{"candidates": [
  {"statement": "Maybe use redis someday", "tags": ["idea"], "confidence": 0.4, "evidence": [{"message_index": 0, "quote": "Maybe use redis someday"}]},
  {"statement": "Prefer conventional commits", "tags": ["git"], "confidence": 0.8, "evidence": [{"message_index": 1, "quote": "Prefer conventional commits"}]}
]}`;
    const result = parseConsolidationResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("Prefer conventional commits");
  });

  test("keeps legacy evidence_hint output parseable but without verified evidence", () => {
    const raw = `{"candidates": [{"statement": "Use patch files first", "tags": ["memory"], "confidence": 0.85, "evidence_hint": "recurring pattern"}]}`;
    const result = parseConsolidationResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].evidence).toEqual([]);
    expect(result[0].evidence_hint).toBe("recurring pattern");
  });

  test("returns empty array for invalid JSON", () => {
    expect(parseConsolidationResponse("not json at all")).toEqual([]);
    expect(parseConsolidationResponse("")).toEqual([]);
    expect(parseConsolidationResponse('{"candidates": "not an array"}')).toEqual([]);
  });

  test("handles JSON embedded in prose", () => {
    const raw = `Okay here you go: {"candidates": [{"statement": "Use patch files first", "tags": ["memory"], "confidence": 0.85, "evidence": [{"message_index": 0, "quote": "Use patch files first"}]}]} done.`;
    const result = parseConsolidationResponse(raw);
    expect(result).toHaveLength(1);
  });
});

describe("runConsolidation", () => {
  test("runs consolidation without persisting an internal PI session", async () => {
    expect(buildConsolidationCommandArgs("prompt", null)).toEqual([
      "-p", "prompt", "--print", "--no-extensions", "--no-session",
    ]);
    expect(buildConsolidationCommandArgs("prompt", "openai/gpt-5")).toEqual([
      "-p", "prompt", "--print", "--no-extensions", "--no-session", "--model", "openai/gpt-5",
    ]);
  });

  test("returns visible failure metadata for consolidation CLI failure", async () => {
    const { dir, cleanup } = tempRoot();
    ensureMemoryDirs(dir);
    const calls: { command: string; args: string[] }[] = [];
    const result = await runConsolidation(dir, ["Use the current Pi model for consolidation", "Make failures visible", "Keep memory governed"], [], "2026-07-09", dir, {
      async exec(command, args) {
        calls.push({ command, args });
        return { code: 1, stdout: "", stderr: "No API key found for anthropic." };
      },
    }, null);
    expect(calls[0].args).not.toContain("--model");
    expect(result.candidates_added).toBe(0);
    expect(result.status).toBe("failed");
    expect(result.failure_reason).toContain("No API key found for anthropic");
    expect(listCandidates(dir)).toHaveLength(0);
    cleanup();
  });
});

describe("applyConsolidation provenance", () => {
  test("creates inbox candidates backed by structured user-authored evidence", () => {
    const { dir, cleanup } = tempRoot();
    ensureMemoryDirs(dir);
    const messages = ["Use bun test for unit tests", "Write types before implementation"];
    const candidates = [
      supportedCandidate(messages[0], 0, ["testing"], 0.85),
      supportedCandidate(messages[1], 1, ["workflow"], 0.9),
    ];
    const result = applyConsolidation(dir, candidates, "2026-05-12", dir, messages);
    expect(result.candidates_extracted).toBe(2);
    expect(result.candidates_added).toBe(2);
    expect(result.candidates_rejected_provenance).toBe(0);
    const inbox = listCandidates(dir);
    expect(inbox).toHaveLength(2);
    expect(inbox[0].status).toBe("new");
    expect(inbox[0].source.type).toBe("conversation");
    expect(inbox[0].source.ref).toMatch(/^session:consolidation-[a-f0-9]{24}:user:0$/);
    expect(inbox[0].thread_id).toMatch(/^consolidation-[a-f0-9]{24}$/);
    expect(inbox[0].evidence_ids).toEqual(inbox[0].evidence_refs);
    expect(inbox[0].evidence_refs[0]).not.toStartWith("daily/");
    expect(inbox[0].primary_trust_class).toBe("agent_inference");
    expect(inbox[0].promotion_eligibility).toBe("review_only");
    const evidence = readEvidenceRecords(dir);
    expect(evidence).toHaveLength(2);
    expect(evidence[0].source_kind).toBe("conversation");
    expect(evidence[0].source_excerpt).toBe(messages[0]);
    expect(evidence[0].trust_class).toBe("single_session_observation");
    expect(evidence[0].source_session_id).toBe(inbox[0].thread_id);
    cleanup();
  });

  test("separates same-day provenance across distinct consolidation input windows", () => {
    const first = tempRoot();
    const second = tempRoot();
    ensureMemoryDirs(first.dir);
    ensureMemoryDirs(second.dir);
    const statement = "Always run typecheck before committing.";

    applyConsolidation(first.dir, [supportedCandidate(statement)], "2026-05-12", "/workspace/project", [statement, "Use bun for package scripts."]);
    applyConsolidation(second.dir, [supportedCandidate(statement)], "2026-05-12", "/workspace/project", [statement, "Use npm for package scripts."]);

    const firstEvidence = readEvidenceRecords(first.dir)[0];
    const secondEvidence = readEvidenceRecords(second.dir)[0];
    expect(firstEvidence.source_session_id).toMatch(/^consolidation-[a-f0-9]{24}$/);
    expect(secondEvidence.source_session_id).toMatch(/^consolidation-[a-f0-9]{24}$/);
    expect(firstEvidence.source_session_id).not.toBe(secondEvidence.source_session_id);
    expect(firstEvidence.id).not.toBe(secondEvidence.id);
    first.cleanup();
    second.cleanup();
  });

  test("rejects fabricated or missing provenance before inbox persistence", () => {
    const { dir, cleanup } = tempRoot();
    ensureMemoryDirs(dir);
    const result = applyConsolidation(dir, [{
      statement: "Always run typecheck before committing",
      tags: ["workflow"],
      confidence: 0.9,
      evidence: [{ message_index: 0, quote: "user explicitly required typecheck" }],
    }], "2026-05-12", dir, ["We should ship this today"]);
    expect(result.candidates_added).toBe(0);
    expect(result.candidates_rejected_provenance).toBe(1);
    expect(listCandidates(dir)).toHaveLength(0);
    expect(readEvidenceRecords(dir)).toHaveLength(0);
    cleanup();
  });

  test("rejects out-of-range message indexes", () => {
    const { dir, cleanup } = tempRoot();
    ensureMemoryDirs(dir);
    const result = applyConsolidation(dir, [{
      statement: "Prefer conventional commits",
      tags: ["git"],
      confidence: 0.9,
      evidence: [{ message_index: 4, quote: "Prefer conventional commits" }],
    }], "2026-05-12", dir, ["Prefer conventional commits"]);
    expect(result.candidates_added).toBe(0);
    expect(result.candidates_rejected_provenance).toBe(1);
    cleanup();
  });

  test("uses existing verification to flag real but non-supportive user evidence", () => {
    const { dir, cleanup } = tempRoot();
    ensureMemoryDirs(dir);
    const result = applyConsolidation(dir, [{
      statement: "Always run project typecheck before committing",
      tags: ["workflow", "testing"],
      confidence: 0.9,
      evidence: [{ message_index: 0, quote: "Session ended." }],
    }], "2026-05-12", dir, ["Session ended."]);
    expect(result.candidates_added).toBe(1);
    const candidate = listCandidates(dir)[0];
    expect(candidate.verification_status).toBe("review_required");
    expect(candidate.verification_result?.failure_reasons).toContain("source_not_supportive");
    expect(candidate.promotion_eligibility).toBe("review_only");
    cleanup();
  });

  test("routes trivial candidates away from durable inbox and creates inquiry for ambiguous important candidate", () => {
    const { dir, cleanup } = tempRoot();
    ensureMemoryDirs(dir);
    const messages = [
      "ok thanks",
      "The release process is critical but unclear.",
      "Always run bun test before committing.",
    ];
    const result = applyConsolidation(dir, [
      supportedCandidate(messages[0], 0, [], 0.9),
      supportedCandidate(messages[1], 1, ["release"], 0.9),
      supportedCandidate(messages[2], 2, ["testing"], 0.9),
    ], "2026-06-01", dir, messages);
    expect(result.candidates_added).toBe(1);
    expect(result.candidates_rejected_worth).toBe(1);
    expect(result.inquiries_created).toBe(1);
    expect(listCandidates(dir).map((c) => c.text)).toEqual(["Always run bun test before committing."]);
    expect(listCandidates(dir)[0].worth_decision).toBe("candidate");
    expect(readOpenInquiries(dir)[0].question).toContain("critical but unclear");
    cleanup();
  });

  test("promotes a consolidation candidate end to end only with structured support", () => {
    const { dir, cleanup } = tempRoot();
    ensureMemoryDirs(dir);
    const statement = "Always run project typecheck before committing.";
    const result = applyConsolidation(dir, [supportedCandidate(statement, 0, ["workflow", "testing"], 0.9)], "2026-07-17", dir, [statement]);
    expect(result.candidates_added).toBe(1);

    const candidate = listCandidates(dir)[0];
    expect(candidate.evidence_ids).toHaveLength(1);
    expect(candidate.primary_trust_class).toBe("agent_inference");
    expect(candidate.promotion_eligibility).toBe("review_only");

    const patch = curateInbox(dir, { now: "2026-07-17T12:00:00.000Z", mode: "propose", minEvidenceCount: 1 });
    expect(patch.ops).toHaveLength(1);
    expect(patch.ops[0].op).toBe("add");
    expect(patch.ops[0].requiresStructuredEvidence).toBe(true);
    expect(patch.ops[0].supportingEvidence).toHaveLength(1);
    expect(patch.ops[0].default_selected).toBe(false);

    const applied = applyPatch(dir, patch, { selectedOpIds: [patch.ops[0].op_id], now: "2026-07-17T12:01:00.000Z" });
    expect(applied.applied_ops).toEqual([patch.ops[0].op_id]);
    expect(applied.skipped_ops).toEqual([]);
    expect(loadActiveRecords(dir).some((record) => record.statement === statement)).toBe(true);
    cleanup();
  });

  test("returns zero counts for empty candidates", () => {
    const { dir, cleanup } = tempRoot();
    ensureMemoryDirs(dir);
    const result = applyConsolidation(dir, [], "2026-05-12", dir, []);
    expect(result.candidates_extracted).toBe(0);
    expect(result.candidates_added).toBe(0);
    expect(result.candidates_rejected_provenance).toBe(0);
    cleanup();
  });
});
