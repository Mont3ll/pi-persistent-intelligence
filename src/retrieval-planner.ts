export type RetrievalIntent = "current" | "historical" | "evidence" | "episode" | "audit";
export type RetrievalSurface = "explicit" | "injection";
export type RetrievalSource = "memory" | "evidence" | "sessions" | "daily" | "events" | "patches" | "tombstones";

export interface RetrievalTemporalPlan {
  mode: "current" | "historical";
  raw_anchor?: string;
  requires_resolution: boolean;
}

export interface RetrievalGovernancePlan {
  require_scope_filter: true;
  require_status_filter: true;
  require_negative_scope_filter: true;
  require_policy_validation: boolean;
  allow_relevance_as_authority: false;
  allow_graph_proximity_as_truth: false;
  include_deleted_content: false;
}

export interface RetrievalExpansionPlan {
  graph_hops: 0;
}

export interface RetrievalPlan {
  version: 1;
  query: string;
  surface: RetrievalSurface;
  intent: RetrievalIntent;
  temporal: RetrievalTemporalPlan;
  sources: RetrievalSource[];
  governance: RetrievalGovernancePlan;
  expansion: RetrievalExpansionPlan;
  rationale: string[];
}

export interface RetrievalPlannerOptions {
  surface?: RetrievalSurface;
}

const AUDIT_PATTERNS = [
  /\baudit\b/i,
  /\baudit history\b/i,
  /\bchange history\b/i,
  /\bhow (?:did|has) .* change\b/i,
  /\bwhat changed\b/i,
];

const EVIDENCE_PATTERNS = [
  /^\s*why\b/i,
  /\bwhy (?:do|did|does|is|was|are|were|we)\b/i,
  /\bevidence\b/i,
  /\bprovenance\b/i,
  /\bsource(?:s)?\b/i,
  /\bsupport(?:ing|ed)?\b/i,
  /\bbasis\b/i,
];

const EPISODE_PATTERNS = [
  /\bwhat happened\b/i,
  /\bwhen did\b/i,
  /\bwhich session\b/i,
  /\bsession(?:s)?\b/i,
  /\bincident\b/i,
  /\bevent(?:s)?\b/i,
];

const HISTORICAL_PATTERNS = [
  /\bwhat did we believe\b/i,
  /\bwhat did we think\b/i,
  /\bas of\b/i,
  /\bat the time\b/i,
  /\bpreviously\b/i,
  /\bhistorical(?:ly)?\b/i,
  /\bbefore\b/i,
];

function matchesAny(query: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(query));
}

function classifyExplicitIntent(query: string): { intent: RetrievalIntent; rationale: string } {
  if (matchesAny(query, AUDIT_PATTERNS)) {
    return { intent: "audit", rationale: "Explicit audit or change-history language requested an audit retrieval plan." };
  }
  if (matchesAny(query, EVIDENCE_PATTERNS)) {
    return { intent: "evidence", rationale: "Evidence, provenance, source, or why-language requested an evidence retrieval plan." };
  }
  if (matchesAny(query, EPISODE_PATTERNS)) {
    return { intent: "episode", rationale: "Event or session language requested an episodic retrieval plan." };
  }
  if (matchesAny(query, HISTORICAL_PATTERNS)) {
    return { intent: "historical", rationale: "Past-state or historical language requested a historical retrieval plan." };
  }
  return { intent: "current", rationale: "No explicit non-current retrieval intent was detected, so current governed memory is the default." };
}

function extractHistoricalAnchor(query: string): string | undefined {
  const iso = query.match(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?\b/);
  if (iso?.[0]) return iso[0];

  const asOf = query.match(/\bas of\s+([^?.!,;]+)/i);
  if (asOf?.[1]?.trim()) return asOf[1].trim();

  const at = query.match(/\bat\s+([^?.!,;]+)/i);
  if (at?.[1]?.trim()) return at[1].trim();

  return undefined;
}

function sourcesForIntent(intent: RetrievalIntent): RetrievalSource[] {
  switch (intent) {
    case "current":
      return ["memory"];
    case "historical":
      return ["memory", "patches", "tombstones"];
    case "evidence":
      return ["memory", "evidence"];
    case "episode":
      return ["sessions", "daily", "events"];
    case "audit":
      return ["memory", "patches", "evidence", "events", "tombstones"];
  }
}

function requiresPolicyValidation(intent: RetrievalIntent): boolean {
  return intent === "current";
}

export function planRetrieval(query: string, options: RetrievalPlannerOptions = {}): RetrievalPlan {
  const normalizedQuery = query.trim();
  const surface = options.surface ?? "explicit";

  const classified = surface === "injection"
    ? {
        intent: "current" as const,
        rationale: "Automatic injection uses current-memory retrieval only; explicit historical, evidence, episode, and audit answers remain separate surfaces.",
      }
    : classifyExplicitIntent(normalizedQuery);

  const historical = classified.intent === "historical";
  const rawAnchor = historical ? extractHistoricalAnchor(normalizedQuery) : undefined;

  return {
    version: 1,
    query: normalizedQuery,
    surface,
    intent: classified.intent,
    temporal: historical
      ? {
          mode: "historical",
          raw_anchor: rawAnchor,
          requires_resolution: true,
        }
      : {
          mode: "current",
          requires_resolution: false,
        },
    sources: sourcesForIntent(classified.intent),
    governance: {
      require_scope_filter: true,
      require_status_filter: true,
      require_negative_scope_filter: true,
      require_policy_validation: requiresPolicyValidation(classified.intent),
      allow_relevance_as_authority: false,
      allow_graph_proximity_as_truth: false,
      include_deleted_content: false,
    },
    expansion: {
      graph_hops: 0,
    },
    rationale: [classified.rationale],
  };
}
