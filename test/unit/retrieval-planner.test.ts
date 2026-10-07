import { describe, expect, test } from "bun:test";
import { planRetrieval } from "../../src/retrieval-planner";

describe("governed retrieval planner", () => {
  test("defaults explicit queries to current governed memory", () => {
    const plan = planRetrieval("What do we currently believe about release verification?");

    expect(plan.version).toBe(1);
    expect(plan.surface).toBe("explicit");
    expect(plan.intent).toBe("current");
    expect(plan.temporal).toEqual({ mode: "current", requires_resolution: false });
    expect(plan.sources).toEqual(["memory"]);
    expect(plan.governance.require_policy_validation).toBe(true);
  });

  test("keeps automatic injection on the current-memory surface", () => {
    const plan = planRetrieval("What did we believe about release verification at 2026-09-01?", { surface: "injection" });

    expect(plan.surface).toBe("injection");
    expect(plan.intent).toBe("current");
    expect(plan.temporal).toEqual({ mode: "current", requires_resolution: false });
    expect(plan.sources).toEqual(["memory"]);
    expect(plan.rationale.join(" ")).toContain("explicit historical");
  });

  test("plans historical retrieval without pretending temporal resolution is complete", () => {
    const plan = planRetrieval("What did we believe about release verification at 2026-09-01?");

    expect(plan.intent).toBe("historical");
    expect(plan.temporal).toEqual({
      mode: "historical",
      raw_anchor: "2026-09-01",
      requires_resolution: true,
    });
    expect(plan.sources).toEqual(["memory", "patches", "tombstones"]);
  });

  test("preserves natural-language historical anchors for the temporal slice", () => {
    const plan = planRetrieval("What was our position as of last Tuesday?");

    expect(plan.intent).toBe("historical");
    expect(plan.temporal.mode).toBe("historical");
    expect(plan.temporal.raw_anchor).toBe("last Tuesday");
    expect(plan.temporal.requires_resolution).toBe(true);
  });

  test("plans evidence retrieval for why and provenance questions", () => {
    const whyPlan = planRetrieval("Why do we believe the release audit is mandatory?");
    const provenancePlan = planRetrieval("Show the provenance for the release policy.");

    expect(whyPlan.intent).toBe("evidence");
    expect(whyPlan.sources).toEqual(["memory", "evidence"]);
    expect(provenancePlan.intent).toBe("evidence");
    expect(provenancePlan.sources).toEqual(["memory", "evidence"]);
  });

  test("plans episodic retrieval for what-happened and session questions", () => {
    const happened = planRetrieval("What happened during the capture regression?");
    const session = planRetrieval("Which session introduced the regression?");

    expect(happened.intent).toBe("episode");
    expect(happened.sources).toEqual(["sessions", "daily", "events"]);
    expect(session.intent).toBe("episode");
  });

  test("plans audit retrieval ahead of broader evidence wording", () => {
    const plan = planRetrieval("Audit the change history and evidence for the release policy.");

    expect(plan.intent).toBe("audit");
    expect(plan.sources).toEqual(["memory", "patches", "evidence", "events", "tombstones"]);
  });

  test("never lets relevance or graph proximity become authority", () => {
    const queries = [
      "What do we currently believe about release verification?",
      "What did we believe at 2026-09-01?",
      "Why do we believe the release audit is mandatory?",
      "What happened during the capture regression?",
      "Audit history for the release policy.",
    ];

    for (const query of queries) {
      const plan = planRetrieval(query);
      expect(plan.governance.allow_relevance_as_authority).toBe(false);
      expect(plan.governance.allow_graph_proximity_as_truth).toBe(false);
      expect(plan.governance.include_deleted_content).toBe(false);
      expect(plan.governance.require_scope_filter).toBe(true);
      expect(plan.governance.require_status_filter).toBe(true);
      expect(plan.governance.require_negative_scope_filter).toBe(true);
      expect(plan.expansion.graph_hops).toBe(0);
    }
  });

  test("is deterministic and normalizes surrounding query whitespace", () => {
    const first = planRetrieval("  Audit history for the release policy.  ");
    const second = planRetrieval("  Audit history for the release policy.  ");

    expect(first).toEqual(second);
    expect(first.query).toBe("Audit history for the release policy.");
  });
});
