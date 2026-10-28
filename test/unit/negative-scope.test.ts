import { describe, expect, test } from "bun:test";
import { runMemoryProcessorPipeline } from "../../src/processors";
import type { MemoryRecord, SessionContext } from "../../src/types";

function record(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["workflow"],
    statement: `${id} statement about bun tests.`,
    evidence: [{ type: "manual", ref: "x", note: "n" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-05-19",
    updated_at: "2026-05-19",
    review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "If contradicted, revise." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...overrides,
  };
}

function context(message: string): SessionContext {
  return {
    resource_id: "user:test",
    profile_id: "project:test",
    thread_id: "thread-1",
    latest_user_message: message,
    working_directory: "/tmp/project",
    recent_files_touched: [],
    detected_domain_tags: [],
    is_trivial_prompt: false,
  };
}

describe("NegativeScopeProcessor", () => {
  test("filters records when context matches does_not_apply_when", () => {
    const records = [
      record("mem_keep"),
      record("mem_skip", { does_not_apply_when: ["publishing"] }),
    ];
    const result = runMemoryProcessorPipeline(records, context("publish to npm registry"));
    expect(result.records.map((item) => item.id)).toEqual(["mem_keep"]);
    expect(result.traces.find((trace) => trace.processor === "NegativeScopeProcessor")?.exclusion_reasons).toEqual({
      mem_skip: "does_not_apply_when:publishing",
    });
  });

  test("filters records when context matches known_exceptions", () => {
    const records = [record("mem_skip", { known_exceptions: ["GitHub Packages"] })];
    const result = runMemoryProcessorPipeline(records, context("GitHub Packages publish workflow"));
    expect(result.records).toHaveLength(0);
    expect(result.traces.find((trace) => trace.processor === "NegativeScopeProcessor")?.exclusion_reasons.mem_skip).toBe("known_exceptions:GitHub Packages");
  });

  test("hyphenated project identifiers are atomic rather than fuzzy shared tokens", () => {
    const records = [record("mem_scoped", { does_not_apply_when: ["repo-b"] })];
    const inRepoA = runMemoryProcessorPipeline(records, {
      ...context("Avoid em dashes in my public writing."),
      repository_id: "repo-a",
      working_directory: "/projects/repo-a",
    });
    expect(inRepoA.records.map((item) => item.id)).toEqual(["mem_scoped"]);

    const inRepoB = runMemoryProcessorPipeline(records, {
      ...context("Avoid em dashes in my public writing."),
      repository_id: "repo-b",
      working_directory: "/projects/repo-b",
    });
    expect(inRepoB.records).toHaveLength(0);
    expect(inRepoB.traces.find((item) => item.processor === "NegativeScopeProcessor")?.exclusion_reasons.mem_scoped)
      .toBe("does_not_apply_when:repo-b");
  });

  test("project identifier boundaries prevent prefix and suffix collisions", () => {
    const records = [record("mem_except", { known_exceptions: ["repo-b"] })];
    for (const project of ["repo-a", "repo-b2", "repo-b-preview", "other-repo-b"]) {
      const result = runMemoryProcessorPipeline(records, {
        ...context("Review the release checklist"),
        repository_id: project,
        working_directory: `/projects/${project}`,
      });
      expect(result.records.map((item) => item.id)).toEqual(["mem_except"]);
    }
    const exact = runMemoryProcessorPipeline(records, {
      ...context("Review the release checklist"),
      repository_id: "repo-b",
      working_directory: "/projects/repo-b",
    });
    expect(exact.records).toHaveLength(0);
  });

  test("legacy records without exception fields remain compatible", () => {
    const records = [record("mem_legacy")];
    const result = runMemoryProcessorPipeline(records, context("run bun tests"));
    expect(result.records.map((item) => item.id)).toEqual(["mem_legacy"]);
  });
});
