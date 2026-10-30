import { describe, expect, test } from "bun:test";
import {
  semanticRequest, validateSemanticProposal, proposeSemanticReview,
  type SemanticRequest, type SemanticProposition,
} from "../../src/semantic-assessment";

const text = "For this project, always use Bun. For this trial only, run the lapis audit.";
const source = { sessionId: "s1", turnId: "t1", text };
const request = semanticRequest(source);
const span = (quote: string, overrides: Partial<SemanticProposition> = {}): SemanticProposition => {
  const start = text.indexOf(quote);
  if (start < 0) throw new Error("fixture substring missing");
  return {
    start, end: start + quote.length, quote,
    disposition: "durable", endorsement: "direct_user",
    duration: "standing", scope: "project", ...overrides,
  };
};
const wrap = (items: SemanticProposition[], req: SemanticRequest = request) => ({
  version: 1 as const, sourceHash: req.source.hash,
  outcome: "proposed" as const, propositions: items,
});

describe("R4 source-grounded semantic assessment (proposal-only pilot)", () => {
  test("request pins original text and a deterministic source hash", () => {
    expect(request.source.role).toBe("user");
    expect(request.source.text).toBe(text);
    expect(request.source.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(semanticRequest(source).source.hash).toBe(request.source.hash);
    expect(() => semanticRequest({ ...source, text: "" })).toThrow();
  });
  test("multiple atomic source spans and bounded temporary meaning remain proposal-only", () => {
    const result = validateSemanticProposal(request, wrap([
      span("For this project, always use Bun."),
      span("For this trial only, run the lapis audit.", {
        disposition: "temporary", duration: "bounded",
      }),
    ]));
    expect(result.status).toBe("proposal_only");
    expect(result.canApply).toBe(false);
    if (result.status === "proposal_only") {
      expect(result.result.propositions).toHaveLength(2);
      expect(result.result.propositions[1]!.duration).toBe("bounded");
    }
  });
  test("model cannot claim mutation authorization via additional fields", () => {
    const result = validateSemanticProposal(request, {
      ...wrap([span("For this project, always use Bun.")]),
      canApply: true, default_selected: true,
    });
    expect(result).toEqual({ status: "abstain", reason: "invalid_envelope", canApply: false });
  });
  test("original source mismatch and invented quotations abstain", () => {
    expect(validateSemanticProposal(request, { ...wrap([span("For this project, always use Bun.")]),
      sourceHash: "0".repeat(64) }).status).toBe("abstain");
    expect(validateSemanticProposal(request, wrap([{
      ...span("For this project, always use Bun."), quote: "Invented policy",
    }])).status).toBe("abstain");
  });
  test("invalid boundaries and overlapping spans abstain", () => {
    expect(validateSemanticProposal(request, wrap([{
      ...span("For this project, always use Bun."), end: text.length + 1,
    }])).status).toBe("abstain");
    expect(validateSemanticProposal(request, wrap([
      span("For this project, always use Bun."),
      span("always use Bun."),
    ])).status).toBe("abstain");
  });
  test("an explicit model abstention is non-authoritative", () => {
    expect(validateSemanticProposal(request, {
      version: 1, sourceHash: request.source.hash, outcome: "abstain", propositions: [],
    })).toEqual({ status: "abstain", reason: "model_abstained", canApply: false });
  });
  test("model failure and malformed output fail closed without throwing", async () => {
    expect(await proposeSemanticReview(source, { assess: async () => { throw new Error("offline"); } }))
      .toEqual({ status: "abstain", reason: "assessor_unavailable", canApply: false });
    expect((await proposeSemanticReview(source, { assess: async () => "not json" })).status).toBe("abstain");
    expect((await proposeSemanticReview({ ...source, text: "" }, { assess: async () => null })).status).toBe("abstain");
  });
  test("valid output does not become an authorized memory write", async () => {
    const result = await proposeSemanticReview(source, { assess: async () =>
      wrap([span("For this project, always use Bun.")]) });
    expect(result.status).toBe("proposal_only");
    expect(result.canApply).toBe(false);
  });
});
