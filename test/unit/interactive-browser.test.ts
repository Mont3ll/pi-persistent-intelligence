import { describe, expect, test } from "bun:test";
import { InteractiveBrowser } from "../../src/tui/InteractiveBrowser";

type Item = { id: string; type: string; confidence: number; status: string; text: string };

function items(count: number): Array<{ id: string; item: Item; searchText: string; details: string[]; status: "healthy" | "warning" | "error" | "info" }> {
  return Array.from({ length: count }, (_, i) => {
    const item = { id: `item_${i}`, type: i % 2 ? "candidate" : "memory", confidence: i / Math.max(1, count), status: i % 9 === 0 ? "warning" : "active", text: `${i % 5 === 0 ? "privacy" : "testing"} record ${i}` };
    return { id: item.id, item, searchText: `${item.id} ${item.type} ${item.status} ${item.text}`, details: [`Evidence ev_${i}`, `Confidence ${item.confidence.toFixed(2)}`], status: i % 9 === 0 ? "warning" : "healthy" };
  });
}

function browser(count: number, pageSize = 20) {
  return new InteractiveBrowser<Item>({
    title: "Test Browser",
    items: items(count),
    pageSize,
    sortBy: "confidence",
    columns: [
      { key: "id", label: "ID", width: 12, minWidth: 8, render: (item) => item.id, sortValue: (item) => item.id },
      { key: "type", label: "Type", width: 10, minWidth: 6, render: (item) => item.type },
      { key: "confidence", label: "Conf", width: 6, minWidth: 5, render: (item) => item.confidence.toFixed(2), sortValue: (item) => item.confidence },
      { key: "text", label: "Text", minWidth: 12, render: (item) => item.text },
    ],
    detailTitle: (item) => item.id,
    detailLines: (item) => [`Status ${item.status}`, `Text ${item.text}`],
  });
}

describe("InteractiveBrowser", () => {
  test("paginates large result sets without rendering every row", () => {
    const panel = browser(1000, 20);
    const lines = panel.render(120);
    expect(lines.join("\n")).toContain("Page 1 / 50");
    expect(lines.join("\n")).toContain("Showing 1–20 of 1000");
    expect(lines.length).toBeLessThan(40);
  });

  test("supports next previous home and end navigation", () => {
    const panel = browser(45, 10);
    panel.handleInput("n");
    expect(panel.getState().page).toBe(1);
    expect(panel.getState().cursor).toBe(10);
    panel.handleInput("p");
    expect(panel.getState().page).toBe(0);
    panel.handleInput("end");
    expect(panel.getState().page).toBe(4);
    expect(panel.getState().cursor).toBe(44);
    panel.handleInput("home");
    expect(panel.getState().page).toBe(0);
    expect(panel.getState().cursor).toBe(0);
  });

  test("filters live in search mode without rerunning retrieval", () => {
    const panel = browser(100, 20);
    panel.handleInput("/");
    for (const ch of "privacy") panel.handleInput(ch);
    const state = panel.getState();
    expect(state.searchMode).toBe(true);
    expect(state.filtered).toBe(20);
    const text = panel.render(100).join("\n");
    expect(text).toContain("filtered from 100");
    expect(text).toContain("privacy");
  });

  test("expands selected row details lazily", () => {
    const panel = browser(5, 5);
    expect(panel.render(100).join("\n")).not.toContain("Status active");
    panel.handleInput("enter");
    const text = panel.render(100).join("\n");
    expect(text).toContain("item_0");
    expect(text).toContain("Evidence ev_0");
  });

  test("keeps every rendered line within terminal width", () => {
    const panel = browser(50, 10);
    for (const width of [60, 80, 120, 200]) {
      for (const line of panel.render(width)) expect(line.length).toBeGreaterThan(0);
      expect(panel.render(width).every((line) => line.replace(/\x1b\[[0-9;]*m/g, "").length <= width)).toBe(true);
    }
  });

  test("supports a frame with only top and bottom separators", () => {
    const panel = new InteractiveBrowser<Item>({
      title: "Memory Inbox Browser",
      items: items(2),
      columns: [{ key: "id", label: "ID", width: 12, render: (item) => item.id }],
      separatorStyle: "frame",
    });
    const plain = panel.render(80).map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
    const separators = plain.filter((line) => /^─+$/.test(line));
    expect(separators).toHaveLength(2);
    expect(plain[0]).toMatch(/^─+$/);
    expect(plain[1]).toContain("Memory Inbox Browser");
    const titleIndex = plain.findIndex((line) => line.includes("Memory Inbox Browser"));
    const headerIndex = plain.findIndex((line) => /^\s*ID\s/.test(line));
    const rowIndex = plain.findIndex((line) => line.includes("item_0"));
    const controlsIndex = plain.findIndex((line) => line.includes("↑↓ move"));
    expect(plain[headerIndex - 1]?.trim()).toBe("");
    expect(plain[rowIndex - 1]?.trim()).toBe("");
    expect(plain[controlsIndex - 1]?.trim()).toBe("");
    expect(titleIndex).toBe(1);
    expect(plain.at(-2)).toContain("↑↓ move");
    expect(plain.at(-1)).toMatch(/^─+$/);
  });

  test("renders empty states", () => {
    const panel = browser(0, 20);
    const text = panel.render(80).join("\n");
    expect(text).toContain("No results");
    expect(text).toContain("Page 1 / 1");
  });
});
