import { createHash } from "node:crypto";

/** Advisory model output: no canonical mutation authority. */
export interface OriginalTurn { sessionId: string; turnId: string; text: string }
export interface SemanticRequest {
  version: 1;
  source: { role: "user"; sessionId: string; turnId: string; hash: string; text: string };
  instructions: string;
}
export type Duration = "standing" | "bounded" | "unknown";
export type Endorsement = "direct_user" | "quoted" | "reported" | "unknown";
export type Disposition = "durable" | "temporary" | "not_memory" | "uncertain";
export interface SemanticProposition {
  start: number; end: number; quote: string;
  disposition: Disposition; endorsement: Endorsement;
  duration: Duration; scope: "project" | "global" | "session" | "unknown";
}
export interface SemanticProposal {
  version: 1; sourceHash: string;
  outcome: "proposed" | "abstain";
  propositions: SemanticProposition[];
}
export type SemanticReview =
  | { status: "proposal_only"; result: SemanticProposal; canApply: false }
  | { status: "abstain"; reason: string; canApply: false };
export interface SemanticAdapter { assess(req: SemanticRequest): Promise<unknown> }

const hash = (s: string): string => createHash("sha256").update(s).digest("hex");
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const choice = (x: unknown, opts: readonly string[]): boolean => typeof x === "string" && opts.includes(x);

export function semanticRequest(turn: OriginalTurn): SemanticRequest {
  if (!turn.sessionId || !turn.turnId || !turn.text || turn.text.length > 32000)
    throw new Error("invalid_original_turn");
  return {
    version: 1, source: { role: "user", sessionId: turn.sessionId,
      turnId: turn.turnId, hash: hash(turn.text), text: turn.text },
    instructions: [
      "Return JSON only: version=1, sourceHash, outcome, propositions.",
      "Extract atomic propositions and exact UTF-16 [start,end) source spans.",
      "Quote must equal the original substring. Label durable/temporary/uncertain/not_memory,",
      "direct_user/quoted/reported/unknown endorsement, standing/bounded/unknown duration,",
      "and project/global/session/unknown scope. Abstain if uncertain.",
      "Never propose or perform canonical memory mutation. Source hashes do not prove endorsement.",
    ].join(" "),
  };
}

export function validateSemanticProposal(req: SemanticRequest, data: unknown): SemanticReview {
  const abstain = (reason: string): SemanticReview => ({ status: "abstain", reason, canApply: false });
  if (!obj(data) || Object.keys(data).some(k => !["version", "sourceHash", "outcome", "propositions"].includes(k))
    || data.version !== 1 || data.sourceHash !== req.source.hash
    || !choice(data.outcome, ["proposed", "abstain"])
    || !Array.isArray(data.propositions) || data.propositions.length > 12)
    return abstain("invalid_envelope");
  if (data.outcome === "abstain")
    return abstain(data.propositions.length === 0 ? "model_abstained" : "invalid_abstention");
  if (!data.propositions.length) return abstain("empty_proposal");
  const items: SemanticProposition[] = [];
  for (const p of data.propositions as unknown[]) {
    if (!obj(p) || Object.keys(p).some(k => !["start", "end", "quote", "disposition", "endorsement", "duration", "scope"].includes(k))
      || !Number.isSafeInteger(p.start) || !Number.isSafeInteger(p.end)
      || typeof p.start !== "number" || typeof p.end !== "number"
      || p.start < 0 || p.end <= p.start || p.end > req.source.text.length
      || typeof p.quote !== "string" || p.quote !== req.source.text.slice(p.start, p.end)
      || !choice(p.disposition, ["durable", "temporary", "not_memory", "uncertain"])
      || !choice(p.endorsement, ["direct_user", "quoted", "reported", "unknown"])
      || !choice(p.duration, ["standing", "bounded", "unknown"])
      || !choice(p.scope, ["project", "global", "session", "unknown"]))
      return abstain("invalid_source_span");
    items.push(p as unknown as SemanticProposition);
  }
  items.sort((a, b) => a.start - b.start);
  if (items.some((p, i) => i > 0 && p.start < items[i - 1]!.end)) return abstain("overlapping_spans");
  return { status: "proposal_only", result: {
    version: 1, sourceHash: req.source.hash, outcome: "proposed", propositions: items,
  }, canApply: false };
}

/** Adapters may be Pi agents, LLMs or future Jev/Laya-style decision models. */
export async function proposeSemanticReview(turn: OriginalTurn, adapter: SemanticAdapter): Promise<SemanticReview> {
  let req: SemanticRequest;
  try { req = semanticRequest(turn); }
  catch { return { status: "abstain", reason: "invalid_source", canApply: false }; }
  try { return validateSemanticProposal(req, await adapter.assess(req)); }
  catch { return { status: "abstain", reason: "assessor_unavailable", canApply: false }; }
}
