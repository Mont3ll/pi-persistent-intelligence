import { createHash } from "node:crypto";

/**
 * Advisory semantic evidence. A well-formed result is NOT memory authorization.
 * Trusted Pi transcript authentication is a separate requirement.
 */
export interface OriginalTurn { sessionId: string; turnId: string; text: string }
export interface SemanticRequest {
  readonly version: 1;
  readonly source: Readonly<{ role: "user"; sessionId: string; turnId: string; hash: string; text: string }>;
  readonly instructions: string;
}
export type Duration = "standing" | "bounded" | "unknown";
export type Endorsement = "direct_user" | "quoted" | "reported" | "unknown";
export type Disposition = "durable" | "temporary" | "not_memory" | "uncertain";
export interface SemanticProposition {
  readonly start: number; readonly end: number; readonly quote: string;
  readonly disposition: Disposition; readonly endorsement: Endorsement;
  readonly duration: Duration; readonly scope: "project" | "global" | "session" | "unknown";
}
export interface SemanticProposal {
  readonly version: 1; readonly sourceHash: string;
  readonly outcome: "proposed" | "abstain";
  readonly propositions: readonly SemanticProposition[];
}
export type SemanticReview =
  | { readonly status: "proposal_only"; readonly result: SemanticProposal; readonly canApply: false }
  | { readonly status: "abstain"; readonly reason: string; readonly canApply: false };
export interface SemanticAdapter { assess(req: SemanticRequest): Promise<unknown> }

type Anchor = Readonly<{ text: string; hash: string; sessionId: string; turnId: string }>;
const originalAnchors = new WeakMap<SemanticRequest, Anchor>();
const hash = (s: string): string => createHash("sha256").update(s).digest("hex");
const obj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const choice = (x: unknown, opts: readonly string[]): boolean => typeof x === "string" && opts.includes(x);
const abstain = (reason: string): SemanticReview => Object.freeze({ status: "abstain", reason, canApply: false });

/**
 * Capture a single inert snapshot before checking any untrusted properties.
 * Never invoke model-owned accessors or retain references to model-owned
 * objects. Unlike checking then copying property reads, descriptors are
 * inspected once and their data values are recursively detached.
 *
 * A hostile in-process adapter may still execute arbitrary code in its own
 * process: this is a consistency boundary, NOT a JavaScript or OS sandbox.
 */
function snapshotModelData(raw: unknown): unknown {
  const seen = new WeakSet<object>();
  let remainingFields = 96;
  const copy = (value: unknown, depth: number): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || depth > 4 || seen.has(value)) throw new Error("invalid_model_value");
    seen.add(value);
    const array = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      throw new Error("invalid_model_prototype");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    remainingFields -= keys.length;
    if (remainingFields < 0 || keys.some(key => typeof key !== "string"))
      throw new Error("invalid_model_keys");
    if (array) {
      const length = descriptors.length;
      if (!length || !Object.hasOwn(length, "value") || typeof length.value !== "number"
        || !Number.isSafeInteger(length.value) || length.value > 12
        || length.value < 0 || keys.length !== length.value + 1)
        throw new Error("invalid_model_array");
      const values: unknown[] = [];
      for (let i = 0; i < length.value; i++) {
        const field = descriptors[String(i)];
        if (!field || !Object.hasOwn(field, "value")) throw new Error("accessor_or_sparse_array");
        values.push(copy(field.value, depth + 1));
      }
      return values;
    }
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const field = descriptors[key];
      if (!field || !Object.hasOwn(field, "value")) throw new Error("accessor_not_allowed");
      result[key] = copy(field.value, depth + 1);
    }
    return result;
  };
  return copy(raw, 0);
}


export function semanticRequest(turn: OriginalTurn): SemanticRequest {
  if (!turn.sessionId || !turn.turnId || !turn.text || turn.text.length > 32_000)
    throw new Error("invalid_original_turn");
  // Capture independent primitive values BEFORE any adapter obtains the request.
  const anchor: Anchor = Object.freeze({
    sessionId: turn.sessionId, turnId: turn.turnId, text: turn.text, hash: hash(turn.text),
  });
  const source = Object.freeze({ role: "user" as const, ...anchor });
  const req: SemanticRequest = Object.freeze({
    version: 1 as const, source,
    instructions: [
      "Return JSON only: version=1, sourceHash, outcome, propositions.",
      "Extract atomic propositions and exact UTF-16 [start,end) source spans.",
      "Quote must equal the original substring. Label durable/temporary/uncertain/not_memory,",
      "direct_user/quoted/reported/unknown endorsement, standing/bounded/unknown duration,",
      "and project/global/session/unknown scope. Abstain if uncertain.",
      "Never propose or perform canonical memory mutation. Source hashes do not prove endorsement.",
    ].join(" "),
  });
  originalAnchors.set(req, anchor);
  return req;
}

/** Check against an independent, private anchor and clone ALL untrusted outputs. */
export function validateSemanticProposal(req: SemanticRequest, raw: unknown): SemanticReview {
  try {
    const anchor = originalAnchors.get(req);
    if (!anchor || req.source.text !== anchor.text || req.source.hash !== anchor.hash
      || req.source.sessionId !== anchor.sessionId || req.source.turnId !== anchor.turnId
      || req.source.role !== "user" || hash(anchor.text) !== anchor.hash)
      return abstain("untrusted_source_anchor");
    const data = snapshotModelData(raw);
    if (!obj(data) || Object.keys(data).some(k => !["version", "sourceHash", "outcome", "propositions"].includes(k))
      || data.version !== 1 || data.sourceHash !== anchor.hash
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
        || p.start < 0 || p.end <= p.start || p.end > anchor.text.length
        || typeof p.quote !== "string" || p.quote !== anchor.text.slice(p.start, p.end)
        || !choice(p.disposition, ["durable", "temporary", "not_memory", "uncertain"])
        || !choice(p.endorsement, ["direct_user", "quoted", "reported", "unknown"])
        || !choice(p.duration, ["standing", "bounded", "unknown"])
        || !choice(p.scope, ["project", "global", "session", "unknown"]))
        return abstain("invalid_source_span");
      // Do not retain a reference to an object controlled by the model/adapter.
      items.push(Object.freeze({
        start: p.start, end: p.end, quote: p.quote,
        disposition: p.disposition as Disposition, endorsement: p.endorsement as Endorsement,
        duration: p.duration as Duration, scope: p.scope as SemanticProposition["scope"],
      }));
    }
    items.sort((a, b) => a.start - b.start);
    if (items.some((p, i) => i > 0 && p.start < items[i - 1]!.end))
      return abstain("overlapping_spans");
    return Object.freeze({
      status: "proposal_only",
      result: Object.freeze({
        version: 1, sourceHash: anchor.hash, outcome: "proposed",
        propositions: Object.freeze([...items]),
      }),
      canApply: false,
    });
  } catch {
    // Untrusted getters, proxies, cyclic and non-JSON objects must abstain.
    return abstain("malformed_assessment");
  }
}

/** Adapters may be Pi agents, LLMs or future Jev/Laya-style decision models. */
export async function proposeSemanticReview(turn: OriginalTurn, adapter: SemanticAdapter): Promise<SemanticReview> {
  let req: SemanticRequest;
  try { req = semanticRequest(turn); }
  catch { return abstain("invalid_source"); }
  try { return validateSemanticProposal(req, await adapter.assess(req)); }
  catch { return abstain("assessor_unavailable"); }
}
