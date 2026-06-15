/**
 * Hybrid search — combines FTS BM25 and qmd semantic results using
 * Reciprocal Rank Fusion (RRF), adapted from pi-code-intelligence's hybridRank.ts.
 *
 * Weights: FTS 0.45 · Semantic 0.55 (same as code-intelligence)
 * Results that rank well in both signals score highest.
 */

import type { FtsSearchResult } from "./fts";

export interface HybridScoreProvenance {
  fts_score?: number;
  semantic_score?: number;
  rrf_score?: number;
  final_score?: number;
  matched_terms?: string[];
  semantic_provider: "qmd" | "none" | "unknown";
  rank_sources: Array<{ source: "fts" | "semantic"; rank: number; score: number; reason?: string }>;
}

export interface HybridResult {
  id: string;
  statement: string;
  layer: "L1" | "L2";
  confidence: number;
  ruleType?: string;
  score: number;
  sources: Array<"fts" | "semantic">;
  score_provenance?: HybridScoreProvenance;
}

const FTS_WEIGHT = 0.45;
const SEMANTIC_WEIGHT = 0.55;
const RRF_K = 60;

function rrfScore(rank: number): number {
  return 1 / (RRF_K + rank + 1);
}

/**
 * Merge FTS results and semantic result IDs (from qmd) into a ranked hybrid list.
 *
 * @param ftsResults  - Ranked list from MemoryFtsIndex.search()
 * @param semanticIds - Ordered IDs from qmd semantic search (first = most relevant)
 * @param recordMap   - Map from ID to { statement, layer, confidence, ruleType } for lookup
 * @param limit       - Maximum results to return
 */
export function mergeHybridResults(
  ftsResults: FtsSearchResult[],
  semanticIds: string[],
  recordMap: Map<string, { statement: string; layer: "L1" | "L2"; confidence: number; ruleType?: string }>,
  limit = 12,
): HybridResult[] {
  const byId = new Map<string, HybridResult>();

  // FTS results
  ftsResults.forEach((r, idx) => {
    const fts = rrfScore(idx) * FTS_WEIGHT;
    byId.set(r.id, {
      id: r.id,
      statement: r.statement,
      layer: r.layer,
      confidence: r.confidence,
      ruleType: r.ruleType,
      score: fts,
      sources: ["fts"],
      score_provenance: { fts_score: fts, rrf_score: fts, final_score: fts, semantic_provider: "none", rank_sources: [{ source: "fts", rank: idx + 1, score: fts, reason: "FTS/BM25 rank" }] },
    });
  });

  // Semantic results
  semanticIds.forEach((id, idx) => {
    const rec = recordMap.get(id);
    if (!rec) return;
    const existing = byId.get(id);
    const semantic = rrfScore(idx) * SEMANTIC_WEIGHT;
    if (existing) {
      const finalScore = existing.score + semantic;
      byId.set(id, {
        ...existing,
        score: finalScore,
        sources: [...existing.sources, "semantic"],
        score_provenance: { ...(existing.score_provenance ?? { semantic_provider: "unknown", rank_sources: [] }), semantic_score: semantic, rrf_score: finalScore, final_score: finalScore, semantic_provider: "qmd", rank_sources: [...(existing.score_provenance?.rank_sources ?? []), { source: "semantic", rank: idx + 1, score: semantic, reason: "qmd semantic rank" }] },
      });
    } else {
      byId.set(id, {
        id,
        statement: rec.statement,
        layer: rec.layer,
        confidence: rec.confidence,
        ruleType: rec.ruleType,
        score: semantic,
        sources: ["semantic"],
        score_provenance: { semantic_score: semantic, rrf_score: semantic, final_score: semantic, semantic_provider: "qmd", rank_sources: [{ source: "semantic", rank: idx + 1, score: semantic, reason: "qmd semantic rank" }] },
      });
    }
  });

  return [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Parse qmd JSON search output to extract memory record IDs.
 * qmd output format: { results: [{ path: "...", ... }] }
 */
export function parseQmdMemoryIds(stdout: string): string[] {
  try {
    const data = JSON.parse(stdout) as { results?: Array<{ path?: string; id?: string }> };
    return (data.results ?? [])
      .map((r) => {
        const raw = r.path ?? r.id ?? "";
        const match = raw.match(/\bmem_[a-zA-Z0-9_]+\b/);
        return match?.[0] ?? "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
