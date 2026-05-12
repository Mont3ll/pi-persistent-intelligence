import { describe, expect, test } from "bun:test";
import { tokenize, buildIndex, search } from "../../../src/sessions/bm25";

describe("tokenize", () => {
  test("lowercases and splits on non-alphanumeric", () => {
    expect(tokenize("Hello World")).toEqual(["hello", "world"]);
  });

  test("filters stop words", () => {
    const tokens = tokenize("the quick brown fox is and");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("and");
    expect(tokens).toContain("quick");
    expect(tokens).toContain("brown");
    expect(tokens).toContain("fox");
  });

  test("handles empty string", () => {
    expect(tokenize("")).toEqual([]);
  });

  test("keeps identifiers with underscores and slashes", () => {
    const tokens = tokenize("memory_write pi/memory");
    expect(tokens).toContain("memory_write");
    expect(tokens).toContain("pi/memory");
  });
});

describe("buildIndex and search", () => {
  const docs = [
    { id: "s1", text: "memory governance patch files audit trail", boostFields: "memory governance" },
    { id: "s2", text: "qmd vault search obsidian zettelkasten", boostFields: "vault search" },
    { id: "s3", text: "pi extension typescript bun test suite", boostFields: "extension tests" },
    { id: "s4", text: "docker podman container setup configuration", boostFields: "container docker" },
  ];
  const items = docs.map((d) => ({ id: d.id, label: d.id }));
  const index = buildIndex(docs);

  test("returns relevant documents for keyword query", () => {
    const results = search(index, items, "memory governance", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].item.id).toBe("s1");
  });

  test("ranks by relevance not insertion order", () => {
    const results = search(index, items, "vault qmd", 5);
    expect(results[0].item.id).toBe("s2");
  });

  test("returns empty for query with no matches", () => {
    const results = search(index, items, "kubernetes helm ingress", 5);
    expect(results).toHaveLength(0);
  });

  test("returns matched terms", () => {
    const results = search(index, items, "patch audit", 5);
    expect(results[0].matchedTerms).toContain("patch");
    expect(results[0].matchedTerms).toContain("audit");
  });

  test("respects limit", () => {
    const results = search(index, items, "the quick test", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});
