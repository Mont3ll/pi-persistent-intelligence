import { describe, expect, test } from "bun:test";
import { runMemoryProcessorPipeline } from "../../src/processors";
import type { MemoryRecord, SessionContext } from "../../src/types";

function record(id: string, updates: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["workflow"],
    statement: `${id} statement about qmd search.`,
    evidence: [{ type: "manual", ref: "x", note: "n" }],
    confidence: 0.8,
    stability: "semi-stable",
    created_at: "2026-05-19",
    updated_at: "2026-05-19",
    review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "If contradicted, revise." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...updates,
  };
}

const context: SessionContext = {
  resource_id: "user:test",
  profile_id: "project:current",
  thread_id: "thread-1",
  project_root: "/tmp/current",
  repository_id: "current",
  working_directory: "/tmp/current",
  latest_user_message: "how should qmd search work?",
  recent_files_touched: [],
  detected_domain_tags: [],
  is_trivial_prompt: false,
};

describe("memory processor pipeline", () => {
  test("filters inactive records and reports processor traces", () => {
    const active = record("mem_active");
    const deprecated = record("mem_deprecated", { status: "deprecated" });

    const result = runMemoryProcessorPipeline([active, deprecated], context);

    expect(result.records.map((item) => item.id)).toEqual(["mem_active"]);
    expect(result.traces[0]).toMatchObject({
      processor: "StatusFilterProcessor",
      input_count: 2,
      output_count: 1,
      exclusion_reasons: { mem_deprecated: "status:deprecated" },
    });
  });

  test("keeps legacy records without profile_id for the current default profile", () => {
    const legacy = record("mem_legacy");

    const result = runMemoryProcessorPipeline([legacy], context);

    expect(result.records.map((item) => item.id)).toEqual(["mem_legacy"]);
    expect(result.traces.find((trace) => trace.processor === "ProfileScopeProcessor")?.exclusion_reasons).toEqual({});
  });

  test("filters records from a different explicit profile", () => {
    const current = record("mem_current", { profile_id: "project:current" });
    const other = record("mem_other", { profile_id: "project:other" });

    const result = runMemoryProcessorPipeline([current, other], context);

    expect(result.records.map((item) => item.id)).toEqual(["mem_current"]);
    expect(result.traces.find((trace) => trace.processor === "ProfileScopeProcessor")?.exclusion_reasons).toEqual({
      mem_other: "profile_mismatch:project:other",
    });
  });

  test("filters project-scoped records for other projects", () => {
    const current = record("mem_current_project", { scope: { type: "project", project: "current" } });
    const other = record("mem_other_project", { scope: { type: "project", project: "other" } });

    const result = runMemoryProcessorPipeline([current, other], context);

    expect(result.records.map((item) => item.id)).toEqual(["mem_current_project"]);
    expect(result.traces.find((trace) => trace.processor === "BasicScopeProcessor")?.exclusion_reasons).toEqual({
      mem_other_project: "project_scope_mismatch:other",
    });
  });
});
