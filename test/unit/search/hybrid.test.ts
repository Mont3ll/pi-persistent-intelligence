import { describe, expect, test } from "bun:test";
import { mergeHybridResults, parseQmdMemoryIds } from "../../../src/search/hybrid";
import type { FtsSearchResult } from "../../../src/search/fts";

const makeRec = (id: string) => ({ statement: `${id} statement`, layer: "L2" as const, confidence: 0.9 });

describe("mergeHybridResults", () => {
  test("returns FTS-only results when no semantic", () => {
    const fts: FtsSearchResult[] = [
      { id: "mem_1", statement: "Use patch files", layer: "L2", confidence: 0.9, score: 1.0 },
      { id: "mem_2", statement: "Run typecheck", layer: "L2", confidence: 0.85, score: 0.8 },
    ];
    const map = new Map([["mem_1", makeRec("mem_1")], ["mem_2", makeRec("mem_2")]]);
    const results = mergeHybridResults(fts, [], map, 5);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("mem_1");
    expect(results[0].sources).toContain("fts");
  });

  test("boosts items matching both FTS and semantic", () => {
    const fts: FtsSearchResult[] = [
      { id: "mem_A", statement: "A", layer: "L2", confidence: 0.9, score: 1.0 },
      { id: "mem_B", statement: "B", layer: "L2", confidence: 0.9, score: 0.5 },
    ];
    const semanticIds = ["mem_B", "mem_A"];
    const map = new Map([["mem_A", makeRec("mem_A")], ["mem_B", makeRec("mem_B")]]);
    const results = mergeHybridResults(fts, semanticIds, map, 5);
    // Both items appear in both signals — should both have combined sources
    for (const id of ["mem_A", "mem_B"]) {
      const r = results.find((x) => x.id === id);
      expect(r).toBeDefined();
      expect(r!.sources).toContain("fts");
      expect(r!.sources).toContain("semantic");
    }
  });

  test("includes semantic-only results from recordMap", () => {
    const fts: FtsSearchResult[] = [];
    const semanticIds = ["mem_semantic"];
    const map = new Map([["mem_semantic", makeRec("mem_semantic")]]);
    const results = mergeHybridResults(fts, semanticIds, map, 5);
    expect(results).toHaveLength(1);
    expect(results[0].sources).toContain("semantic");
  });

  test("respects limit", () => {
    const fts: FtsSearchResult[] = Array.from({ length: 10 }, (_, i) => ({
      id: `mem_${i}`, statement: `S${i}`, layer: "L2" as const, confidence: 0.9, score: 1.0,
    }));
    const map = new Map(fts.map((r) => [r.id, makeRec(r.id)]));
    expect(mergeHybridResults(fts, [], map, 3)).toHaveLength(3);
  });
});

describe("parseQmdMemoryIds", () => {
  test("extracts mem_ IDs from qmd JSON output", () => {
    const json = JSON.stringify({
      results: [
        { path: "rendered/MEMORY.md#mem_abc123" },
        { path: "daily/2026-05-12.md" },
        { id: "mem_xyz789" },
      ],
    });
    const ids = parseQmdMemoryIds(json);
    expect(ids).toContain("mem_abc123");
    expect(ids).toContain("mem_xyz789");
    expect(ids).not.toContain("daily/2026-05-12.md");
  });

  test("returns empty for invalid JSON", () => {
    expect(parseQmdMemoryIds("not json")).toEqual([]);
    expect(parseQmdMemoryIds("")).toEqual([]);
  });
});
