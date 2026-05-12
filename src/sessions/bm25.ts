/**
 * Lightweight BM25 keyword search over session records.
 *
 * No external dependencies. Works on any Node/Bun version.
 * Tokenizes text → computes TF-IDF scores → returns ranked results.
 */

export interface BM25Document {
  id: string;
  text: string;          // full text to index
  boostFields?: string;  // high-weight content (title, decisions, etc.)
}

export interface BM25Result<T> {
  item: T;
  score: number;
  matchedTerms: string[];
}

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by","from","as","is","was","are","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","shall","can","need","dare","ought","used","that","this","these","those","it","its","i","you","he","she","we","they","me","him","her","us","them","my","your","his","our","their","what","which","who","when","where","why","how","all","each","every","both","few","more","most","other","some","such","no","not","only","same","so","than","then","too","very",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_/-]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function termFreq(tokens: string[], term: string): number {
  let count = 0;
  for (const t of tokens) { if (t === term || t.startsWith(term)) count++; }
  return count;
}

/**
 * Build BM25 index from documents.
 */
export interface BM25Index {
  docCount: number;
  avgDocLen: number;
  df: Map<string, number>;     // document frequency per term
  docTokens: Map<string, string[]>;  // id → tokens
}

export function buildIndex(docs: BM25Document[]): BM25Index {
  const df = new Map<string, number>();
  const docTokens = new Map<string, string[]>();
  let totalLen = 0;

  for (const doc of docs) {
    const combined = `${doc.boostFields ?? ""} ${doc.boostFields ?? ""} ${doc.text}`;
    const tokens = tokenize(combined);
    docTokens.set(doc.id, tokens);
    totalLen += tokens.length;
    for (const term of new Set(tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  return {
    docCount: docs.length,
    avgDocLen: docs.length > 0 ? totalLen / docs.length : 1,
    df,
    docTokens,
  };
}

/**
 * Score a single document against query terms using BM25.
 * k1=1.5, b=0.75 are standard BM25 parameters.
 */
const K1 = 1.5;
const B = 0.75;

export function scoreDoc(
  index: BM25Index,
  docId: string,
  queryTerms: string[],
): { score: number; matchedTerms: string[] } {
  const tokens = index.docTokens.get(docId);
  if (!tokens) return { score: 0, matchedTerms: [] };

  const docLen = tokens.length;
  const normFactor = 1 - B + B * (docLen / index.avgDocLen);
  const matched: string[] = [];
  let score = 0;

  for (const term of queryTerms) {
    const df = index.df.get(term) ?? 0;
    if (df === 0) continue;

    const idf = Math.log((index.docCount - df + 0.5) / (df + 0.5) + 1);
    const tf = termFreq(tokens, term);
    if (tf === 0) continue;

    matched.push(term);
    score += idf * ((tf * (K1 + 1)) / (tf + K1 * normFactor));
  }

  return { score, matchedTerms: matched };
}

/**
 * Search index and return top-N scored items.
 */
export function search<T extends { id: string }>(
  index: BM25Index,
  items: T[],
  query: string,
  limit = 10,
): BM25Result<T>[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  const itemById = new Map(items.map((it) => [it.id, it]));
  const results: BM25Result<T>[] = [];

  for (const [docId] of index.docTokens) {
    const { score, matchedTerms } = scoreDoc(index, docId, queryTerms);
    if (score <= 0) continue;
    const item = itemById.get(docId);
    if (!item) continue;
    results.push({ item, score, matchedTerms });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
