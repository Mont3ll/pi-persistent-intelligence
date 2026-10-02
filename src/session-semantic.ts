import { runQmd } from "./qmd";

export const SESSION_QMD_COLLECTION_NAME = "pi-persistent-intelligence-sessions";
export const SESSION_SEMANTIC_TIMEOUT_MS = 10_000;

export function qmdSessionSetupArgs(summariesDir: string): string[] {
  return ["collection", "add", summariesDir, "--name", SESSION_QMD_COLLECTION_NAME];
}

export function qmdSessionSearchArgs(query: string, limit: number): string[] {
  return ["vsearch", "--json", "-c", SESSION_QMD_COLLECTION_NAME, "-n", String(limit), query];
}

export function qmdSessionUpdateArgs(): string[] {
  return ["update", "-c", SESSION_QMD_COLLECTION_NAME];
}

type QmdRunner = (args: string[], timeoutMs: number) => Promise<{ stdout: string; stderr?: string }>;

type SessionSemanticDetails = {
  requested_mode: "semantic";
  executed_mode: "semantic" | "keyword";
  fallback: boolean;
  fallback_reason?: string;
  qmd_collection: string;
  timeout_ms: number;
};

export async function refreshSessionSemanticCollection(
  summariesDir: string,
  qmdRunner: QmdRunner = runQmd,
): Promise<void> {
  try {
    await qmdRunner(qmdSessionSetupArgs(summariesDir), SESSION_SEMANTIC_TIMEOUT_MS);
  } catch {
    // Best effort: the collection may already exist or qmd may be unavailable.
  }

  try {
    await qmdRunner(qmdSessionUpdateArgs(), SESSION_SEMANTIC_TIMEOUT_MS);
  } catch {
    // Semantic retrieval is optional; explicit search still has keyword fallback.
  }
}

export async function runSessionSemanticSearch(options: {
  query: string;
  limit: number;
  qmdRunner?: QmdRunner;
  keywordFallback(): Promise<string>;
}): Promise<{ text: string; details: SessionSemanticDetails }> {
  const qmdRunner = options.qmdRunner ?? runQmd;

  try {
    const result = await qmdRunner(qmdSessionSearchArgs(options.query, options.limit), SESSION_SEMANTIC_TIMEOUT_MS);
    return {
      text: result.stdout || "No semantic session results. Ensure qmd embeddings are complete (run: qmd embed).",
      details: {
        requested_mode: "semantic",
        executed_mode: "semantic",
        fallback: false,
        qmd_collection: SESSION_QMD_COLLECTION_NAME,
        timeout_ms: SESSION_SEMANTIC_TIMEOUT_MS,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const keyword = await options.keywordFallback();
    return {
      text: `Semantic session search unavailable (${reason}). Showing native keyword fallback instead.\n\n${keyword}`,
      details: {
        requested_mode: "semantic",
        executed_mode: "keyword",
        fallback: true,
        fallback_reason: reason,
        qmd_collection: SESSION_QMD_COLLECTION_NAME,
        timeout_ms: SESSION_SEMANTIC_TIMEOUT_MS,
      },
    };
  }
}
