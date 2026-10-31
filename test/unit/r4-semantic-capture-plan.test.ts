import { describe, expect, test } from "bun:test";
import {
  planSemanticCapture, proposeSemanticCapturePlan,
} from "../../src/semantic-capture-plan";
import {
  semanticRequest, validateSemanticProposal,
  type SemanticProposition,
} from "../../src/semantic-assessment";

const source = { sessionId: "session-r4", turnId: "turn-r4", text: "For this project, always run the lapis audit." };
const projectId = "project:verified";
function assess(text: string, propositions: Array<{
  phrase: string; overrides?: Partial<SemanticProposition>;
}>) {
  const original = { ...source, text };
  const req = semanticRequest(original);
  const ps = propositions.map(({ phrase, overrides }) => {
    const start = text.indexOf(phrase);
    if (start < 0) throw new Error("missing fixture");
    return {
      start, end: start + phrase.length, quote: phrase,
      disposition: "durable", endorsement: "direct_user",
      duration: "standing", scope: "project",
      ...overrides,
    };
  });
  return { original, review: validateSemanticProposal(req, {
    version: 1, sourceHash: req.source.hash, outcome: "proposed", propositions: ps,
  }) };
}

describe("R4 semantic proposition capture planning", () => {
  test("single directly endorsed standing project rule becomes a candidate, not an authorized write", () => {
    const { original, review } = assess(source.text, [{ phrase: source.text }]);
    const plan = planSemanticCapture(original, review, projectId);
    expect(plan.outcome).toBe("proposed");
    expect(plan.entries[0]).toMatchObject({
      quote: source.text, route: "durable_candidate",
      projectId, reason: "direct_standing_project_rule",
      automaticPromotionAuthorized: false,
    });
    expect(plan.canonicalWrites).toBe(0);
    expect(plan.automaticPromotionAuthorized).toBe(false);
    expect(Object.isFrozen(plan.entries[0])).toBe(true);
    expect(Object.isFrozen(plan.entries)).toBe(true);
  });

  for (const phrase of [
    "For this project, always run the lapis audit tomorrow.",
    "For this project, always run the lapis audit from 2026-11-01 through 2026-11-02.",
    "For this project, always run the lapis audit until the trial ends.",
  ]) {
    test("temporally bounded " + phrase.slice(-29) + " is daily-only despite always", () => {
      const { original, review } = assess(phrase, [{
        phrase, overrides: { duration: "bounded", disposition: "temporary" },
      }]);
      const plan = planSemanticCapture(original, review, projectId);
      expect(plan.entries[0]?.route).toBe("daily_only");
      expect(plan.entries[0]?.automaticPromotionAuthorized).toBe(false);
    });
  }

  test("quoted example and reported policy remain review-only", () => {
    for (const endorsement of ["quoted", "reported"] as const) {
      const text = 'The manual says: "For this project, always use Bun."';
      const { original, review } = assess(text, [{
        phrase: "For this project, always use Bun.", overrides: { endorsement },
      }]);
      expect(planSemanticCapture(original, review, projectId).entries[0]?.route).toBe("review_required");
    }
  });

  test("a global standing rule is not silently downgraded to a launch project", () => {
    const text = "Across projects, always require explicit publication approval.";
    const { original, review } = assess(text, [{
      phrase: text, overrides: { scope: "global" },
    }]);
    const entry = planSemanticCapture(original, review, projectId).entries[0]!;
    expect(entry.route).toBe("review_required");
    expect(entry.reason).toBe("global_requires_review");
    expect(entry.projectId).toBeUndefined();
  });

  test("mixed statements retain exact later source spans but cannot auto-promote", () => {
    const text = "Please verify this release. For this project, always use Bun.";
    const later = "For this project, always use Bun.";
    const { original, review } = assess(text, [
      { phrase: "Please verify this release.", overrides: { disposition: "temporary", duration: "bounded" } },
      { phrase: later },
    ]);
    const plan = planSemanticCapture(original, review, projectId);
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries[0]?.route).toBe("daily_only");
    expect(plan.entries[1]).toMatchObject({
      quote: later, start: text.indexOf(later), route: "review_required",
      reason: "multi_proposition_requires_review",
    });
  });

  test("abstentions and source mismatches produce no promoted candidates", () => {
    const { original, review } = assess(source.text, [{ phrase: source.text }]);
    const changed = { ...original, text: source.text + " Additional context." };
    expect(planSemanticCapture(changed, review, projectId).outcome).toBe("abstain");
    const held = planSemanticCapture(original, { status: "abstain", reason: "model_abstained", canApply: false }, projectId);
    expect(held.entries).toHaveLength(0);
    expect(held.automaticPromotionAuthorized).toBe(false);
  });

  test("adapter-to-plan integration remains pure and write-free", async () => {
    const result = await proposeSemanticCapturePlan(source, projectId, {
      assess: async (request) => ({
        version: 1, sourceHash: request.source.hash, outcome: "proposed",
        propositions: [{
          start: 0, end: source.text.length, quote: source.text,
          disposition: "durable", endorsement: "direct_user",
          duration: "standing", scope: "project",
        }],
      }),
    });
    expect(result.entries[0]?.route).toBe("durable_candidate");
    expect(result.canonicalWrites).toBe(0);
  });
});
