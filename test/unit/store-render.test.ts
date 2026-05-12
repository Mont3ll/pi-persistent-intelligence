import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { addMemoryRecord, loadActiveRecords } from "../../src/store";
import { renderMemoryMarkdown, renderMemoryToDisk } from "../../src/render";
import type { MemoryRecord } from "../../src/types";

let tempDirs: string[] = [];
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "pi-pi-store-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function record(id: string, layer: "L1" | "L2", statement = "Use canonical JSONL as the governed memory store."): MemoryRecord {
  return {
    id,
    layer,
    scope: { type: "global" },
    tags: ["workflow", "memory"],
    statement,
    evidence: [{ type: "artifact", ref: "design.md", note: "Spec documented" }],
    confidence: 0.91,
    stability: "stable",
    created_at: "2026-05-08",
    updated_at: "2026-05-08",
    review: { cadence_days: 120, next_review: "2026-09-05", change_condition: "If canonical JSONL becomes too heavy, revisit." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
  };
}

describe("store", () => {
  test("adds L1 and L2 records to canonical files and loads active records", () => {
    const root = tempRoot();
    ensureMemoryDirs(root);
    addMemoryRecord(root, record("mem_l1", "L1"));
    addMemoryRecord(root, record("mem_l2", "L2"));
    const active = loadActiveRecords(root);
    expect(active.map((r) => r.id).sort()).toEqual(["mem_l1", "mem_l2"]);
  });
});

describe("render", () => {
  test("renders generated markdown from canonical records", () => {
    const markdown = renderMemoryMarkdown([record("mem_l1", "L1"), record("mem_l2", "L2")]);
    expect(markdown).toContain("Generated from canonical JSONL");
    expect(markdown).toContain("## L1 — Identity");
    expect(markdown).toContain("### mem_l1");
    expect(markdown).toContain("**Confidence**: 0.91");
    expect(markdown).toContain("design.md — Spec documented");
    expect(markdown).toContain("If canonical JSONL becomes too heavy, revisit.");
  });

  test("writes rendered MEMORY.md to disk", () => {
    const root = tempRoot();
    const paths = ensureMemoryDirs(root);
    addMemoryRecord(root, record("mem_l2", "L2"));
    renderMemoryToDisk(root);
    const content = readFileSync(paths.rendered.memory, "utf-8");
    expect(content).toContain("mem_l2");
  });
});
