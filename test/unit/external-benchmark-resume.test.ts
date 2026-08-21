import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendState, readStateJournal, resumeAction, type CaseStateEvent } from "../../eval/external/core/run-state";
import { appendJsonlAtomic, redactPublicArtifact, validateRequiredArtifacts, writeJsonAtomic } from "../../eval/external/core/artifacts";

const event = (stage: CaseStateEvent["stage"], attempt = 1): CaseStateEvent => ({ caseId: "c1", track: "production", stage, attempt, at: `2026-08-01T00:00:0${attempt}Z` });

describe("external benchmark resume", () => {
  test("enforces transitions and chooses resume stage", () => {
    let journal: CaseStateEvent[] = [];
    for (const stage of ["planned", "running", "answered", "evaluated", "verified"] as const) journal = appendState(journal, event(stage));
    expect(resumeAction(journal)).toBe("skip");
    expect(() => appendState([], event("evaluated"))).toThrow("illegal case transition");
    expect(resumeAction(journal.slice(0, 3))).toBe("evaluate");
    expect(resumeAction(journal.slice(0, 4))).toBe("verify");
  });
  test("retains interrupted attempts and restarts the failed stage", () => {
    const journal = [event("planned"), event("running"), { ...event("failed"), failedStage: "running" as const, errorClass: "transient", retryable: true }];
    expect(resumeAction(journal)).toBe("answer");
    expect(() => appendState(journal, event("running", 1))).toThrow("attempt must increase");
    expect(appendState(journal, event("running", 2))).toHaveLength(4);
  });
  test("writes atomic JSON and append-only journals", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-benchmark-artifacts-")); const json = join(dir, "a.json"); const journal = join(dir, "state.jsonl");
    writeJsonAtomic(json, { b: 2, a: 1 }); appendJsonlAtomic(journal, event("planned")); appendJsonlAtomic(journal, event("running"));
    expect(readFileSync(json, "utf8")).toBe('{"a":1,"b":2}\n');
    expect(readStateJournal(journal)).toHaveLength(2);
    expect(existsSync(`${json}.tmp`)).toBe(false);
  });
  test("redacts private output and validates required artifacts", () => {
    const redacted = redactPublicArtifact({ path: "/home/alice/project", tmp: "/tmp/request-1", authorization: "Bearer secret", apiKey: "sk-secret", requestId: "req_123", modelId: "gpt-test", hash: "a".repeat(64) });
    expect(JSON.stringify(redacted)).not.toContain("alice"); expect(redacted.modelId).toBe("gpt-test"); expect(redacted.hash).toBe("a".repeat(64));
    const dir = mkdtempSync(join(tmpdir(), "pi-benchmark-required-")); writeJsonAtomic(join(dir, "manifest.json"), {});
    expect(validateRequiredArtifacts(dir, ["manifest.json", "missing.json"])).toEqual(["missing.json"]);
  });
});
