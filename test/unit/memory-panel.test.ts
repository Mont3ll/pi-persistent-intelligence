import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  createMemoryPanelTheme,
  renderMemoryPanelControls,
  renderMemoryPanelHeader,
  wrapPanelHanging,
} from "../../src/tui/memory-panel";

describe("memory panel presentation", () => {
  test("renders compact headers and controls within narrow widths", () => {
    const theme = createMemoryPanelTheme(undefined);
    const lines = [
      ...renderMemoryPanelHeader(theme, 32, "Memory Inbox", "3 candidates · 2 eligible"),
      ...renderMemoryPanelControls(theme, 32, ["↑↓ move", "Enter confirm", "Esc cancel"]),
    ];

    expect(lines.every((line) => visibleWidth(line) <= 32)).toBe(true);
    expect(lines.some((line) => /^─+$/.test(line))).toBe(false);
  });

  test("wraps hanging content without exceeding the prompt width", () => {
    const theme = createMemoryPanelTheme(undefined);
    const lines = wrapPanelHanging(theme.dim("why: "), theme.content("A long explanation that must wrap safely inside a narrow prompt."), 24);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => visibleWidth(line) <= 24)).toBe(true);
  });
});
