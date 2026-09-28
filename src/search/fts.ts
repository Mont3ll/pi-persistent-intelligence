/**
 * SQLite FTS5 index for memory records.
 *
 * Uses Bun's built-in `bun:sqlite` — no external dependencies.
 * Eliminates the hard dependency on qmd for basic keyword memory search.
 *
 * Provides:
 * - sync(records): index all active records
 * - search(query, limit): BM25 keyword search
 * - close(): release database
 *
 * Falls back gracefully: if FTS is unavailable, callers should fall back
 * to in-memory term matching (the existing retriever logic).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let BunDatabase: typeof import("bun:sqlite").Database | null = null;
try {
  BunDatabase = (await import("bun:sqlite")).Database;
} catch {
  // not running under Bun — FTS will be unavailable
}

export interface FtsSearchResult {
  id: string;
  statement: string;
  layer: "L1" | "L2";
  confidence: number;
  ruleType?: string;
  score: number;
}

export class MemoryFtsIndex {
  private db: InstanceType<typeof import("bun:sqlite").Database> | null = null;
  private available = false;

  constructor(private readonly dbPath: string) {
    if (!BunDatabase) return;
    try {
      mkdirSync(dirname(dbPath), { recursive: true });
      this.db = new BunDatabase(dbPath);
      const db = this.db as any;
      db.exec("PRAGMA journal_mode=WAL;");
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
          id UNINDEXED,
          layer UNINDEXED,
          rule_type UNINDEXED,
          confidence UNINDEXED,
          statement,
          tags,
          tokenize='porter unicode61'
        );
      `);
      db.exec("CREATE TABLE IF NOT EXISTS memory_fts_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
      this.available = true;
    } catch {
      this.db = null;
      this.available = false;
    }
  }

  get isAvailable(): boolean {
    return this.available;
  }

  getGeneration(): number | null {
    if (!this.db || !this.available) return null;
    try {
      const row = (this.db as any).prepare("SELECT value FROM memory_fts_meta WHERE key = 'canonical_generation'").get() as { value?: string } | null;
      if (!row?.value) return null;
      const value = Number(row.value);
      return Number.isInteger(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  }

  /** Replace the entire index with the provided records. Fast for small corpora. */
  sync(records: Array<{ id: string; layer: string; ruleType?: string; confidence: number; statement: string; tags: string[] }>, generation = 0): void {
    if (!this.db || !this.available) return;
    const db = this.db as any;
    try {
      db.exec("BEGIN IMMEDIATE;");
      db.exec("DELETE FROM memory_fts;");
      const insert = db.prepare(
        "INSERT INTO memory_fts (id, layer, rule_type, confidence, statement, tags) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const r of records) {
        insert.run(r.id, r.layer, r.ruleType ?? "", r.confidence, r.statement, r.tags.join(" "));
      }
      db.prepare("INSERT INTO memory_fts_meta (key, value) VALUES ('canonical_generation', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(generation));
      db.exec("COMMIT;");
    } catch {
      try { db.exec("ROLLBACK;"); } catch { /* ignore rollback failures */ }
    }
  }

  search(query: string, limit = 10): FtsSearchResult[] {
    if (!this.db || !this.available || !query.trim()) return [];
    try {
      const db = this.db as any;
      const safeQuery = query.replace(/["'*()]/g, " ").trim();
      if (!safeQuery) return [];
      const rows = db
        .prepare(`
          SELECT id, layer, rule_type, confidence, statement,
                 bm25(memory_fts) AS score
          FROM memory_fts
          WHERE memory_fts MATCH ?
          ORDER BY bm25(memory_fts)
          LIMIT ?
        `)
        .all(safeQuery, limit) as Array<{
          id: string; layer: string; rule_type: string;
          confidence: number; statement: string; score: number;
        }>;
      return rows.map((r) => ({
        id: r.id,
        statement: r.statement,
        layer: r.layer as "L1" | "L2",
        confidence: r.confidence,
        ruleType: r.rule_type || undefined,
        score: Math.abs(r.score),
      }));
    } catch {
      return [];
    }
  }

  close(): void {
    try { (this.db as any)?.close(); } catch { /* ignore */ }
    this.db = null;
  }
}
