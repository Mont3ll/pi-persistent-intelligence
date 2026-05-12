import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { addScratchpadItem, clearDoneScratchpadItems, listScratchpadItems, markScratchpadDone, markScratchpadUndone } from "../../src/scratchpad";
import { appendDailyLog, readDailyLog } from "../../src/daily";

let tempDirs: string[] = [];
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "pi-pi-scratch-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("scratchpad", () => {
  test("adds, completes, reopens, and clears checklist items", () => {
    const root = tempRoot();
    ensureMemoryDirs(root);
    addScratchpadItem(root, "review memory patch");
    addScratchpadItem(root, "write docs");
    expect(listScratchpadItems(root).map((item) => item.text)).toEqual(["review memory patch", "write docs"]);
    markScratchpadDone(root, "review");
    expect(listScratchpadItems(root)[0].done).toBe(true);
    markScratchpadUndone(root, "review");
    expect(listScratchpadItems(root)[0].done).toBe(false);
    markScratchpadDone(root, "write");
    clearDoneScratchpadItems(root);
    expect(listScratchpadItems(root).map((item) => item.text)).toEqual(["review memory patch"]);
  });
});

describe("daily", () => {
  test("appends and reads a daily log", () => {
    const root = tempRoot();
    ensureMemoryDirs(root);
    appendDailyLog(root, "2026-05-08", "#decision Use JSONL canonically.");
    appendDailyLog(root, "2026-05-08", "#lesson Render markdown for qmd.");
    const content = readDailyLog(root, "2026-05-08");
    expect(content).toContain("#decision Use JSONL canonically.");
    expect(content).toContain("#lesson Render markdown for qmd.");
  });
});
