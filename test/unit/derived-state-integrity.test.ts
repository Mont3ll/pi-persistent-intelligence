import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderMemoryMarkdown } from "../../src/render";
import { MemoryFtsIndex } from "../../src/search/fts";
import type { MemoryRecord } from "../../src/types";

let dirs: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-derived-state-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function record(id: string, status: MemoryRecord["status"]): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["derived-state"],
    statement: `Statement for ${id}`,
    evidence: [{ type: "manual", ref: "ev1", note: "support" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-05-01",
    updated_at: "2026-05-01",
    review: { cadence_days: 30, next_review: "2026-06-01", change_condition: "If contradicted." },
    status,
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
  };
}

describe("derived-state integrity", () => {
  test("rendered memory separates current, contested, and auditable non-deleted history", () => {
    const markdown = renderMemoryMarkdown([
      record("mem_active", "active"),
      record("mem_contested", "contested"),
      record("mem_deprecated", "deprecated"),
      record("mem_superseded", "superseded"),
      record("mem_promoted", "promoted"),
      record("mem_deleted", "deleted"),
    ]);

    expect(markdown).toContain("### mem_active");
    expect(markdown).toContain("## Contested — Review Required");
    expect(markdown).toContain("> Contested memory is not current truth and must be reviewed before use.");
    expect(markdown).toContain("### mem_contested");
    expect(markdown).toContain("## History");
    expect(markdown).toContain("### mem_deprecated");
    expect(markdown).toContain("### mem_superseded");
    expect(markdown).toContain("### mem_promoted");
    expect(markdown).not.toContain("### mem_deleted");
    expect(markdown).not.toContain("Statement for mem_deleted");

    const current = markdown.split("## Contested — Review Required")[0];
    expect(current).toContain("### mem_active");
    expect(current).not.toContain("### mem_contested");
    expect(current).not.toContain("### mem_deprecated");
    expect(current).not.toContain("### mem_superseded");
    expect(current).not.toContain("### mem_promoted");
    expect(current).not.toContain("### mem_deleted");
  });

  test("failed FTS rebuild rolls back instead of exposing a partial replacement", () => {
    const dir = root();
    const index = new MemoryFtsIndex(join(dir, "memory.sqlite"));
    expect(index.isAvailable).toBe(true);

    index.sync([{ id: "mem_old", layer: "L2", confidence: 0.9, statement: "rollbackseed baseline", tags: ["stable"] }]);
    expect(index.search("rollbackseed").map((item) => item.id)).toEqual(["mem_old"]);

    index.sync([
      { id: "mem_new", layer: "L2", confidence: 0.9, statement: "partialcandidate replacement", tags: ["new"] },
      { id: "mem_bad", layer: "L2", confidence: 0.9, statement: "invalid row", tags: [Symbol("bad") as unknown as string] },
    ]);

    expect(index.search("rollbackseed").map((item) => item.id)).toEqual(["mem_old"]);
    expect(index.search("partialcandidate")).toEqual([]);
    index.close();
  });
});
