import { join } from "node:path";
import { buildRetrievalContext, readLastInjectionStats, syncFtsIndex } from "../../../src/retriever";
import { MemoryFtsIndex } from "../../../src/search/fts";
import type { BenchmarkQuery, TrackConfig } from "../core/protocol";
import type { TrackQueryResult } from "./types";

export async function retrieveBenchmarkContext(root: string, query: BenchmarkQuery, config: TrackConfig, diagnostic: boolean, candidateIds: string[]): Promise<TrackQueryResult> {
  const fts = new MemoryFtsIndex(join(root, "runtime", "benchmark-fts.sqlite"));
  try {
    syncFtsIndex(root, fts);
    const retrievalOptions = {
      prompt: query.text,
      today: (config.now ?? new Date().toISOString()).slice(0, 10),
      maxRecords: config.maxRecords,
      maxTotalChars: config.maxChars,
      useQmd: false,
      cwd: root,
      threadId: "benchmark-case",
    };
    let result = await buildRetrievalContext(root, { ...retrievalOptions, ftsIndex: fts });
    if (result.selectedMemory.length === 0) result = await buildRetrievalContext(root, retrievalOptions);
    const context = result.selectedMemory.map((record) => record.statement).join("\n").slice(0, config.maxChars);
    const stats = readLastInjectionStats(root);
    return {
      context,
      selectedIds: result.selectedMemory.map((record) => record.id).slice(0, config.maxRecords),
      diagnostic,
      trace: {
        candidateIds: [...candidateIds],
        processorExclusions: [...new Set(result.processorTraces.flatMap((trace) => trace.excluded_ids))],
        injectedChars: Math.min(stats?.charCount ?? context.length, config.maxChars),
      },
    };
  } finally { fts.close(); }
}
