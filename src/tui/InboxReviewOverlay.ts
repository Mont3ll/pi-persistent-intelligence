/**
 * InboxReviewOverlay — summary prompt shown before the first agent turn.
 *
 * Uses the same color mappings as PatchReviewPanel (via themeFromInbox which
 * mirrors PatchReviewPanel's themeFromPi) for visual consistency across the
 * extension. Same separator style, same accent/success/warning/dim semantics.
 *
 * Actions:
 *   [a] / Enter on "Apply"  → approve auto-eligible candidates
 *   [r] / Enter on "Review" → open PatchReviewPanel for per-op selection
 *   [s] / Enter on "Skip"   → dismiss; candidates stay in inbox
 *   Esc / q                 → same as skip
 *
 * Factory: createInboxReviewComponent(opts, theme, tui, done)
 *   Mirrors createPatchReviewComponent's interface; calls tui.requestRender()
 *   after every input so the TUI re-renders on key presses.
 */

import { matchesKey } from "@earendil-works/pi-tui";
import type { CaptureCandidate } from "../types";
import {
  createMemoryPanelTheme,
  panelWidth,
  renderMemoryPanelControls,
  renderMemoryPanelHeader,
  renderMemoryPanelSeparator,
  wrapPanelHanging,
  wrapPanelLine,
  type MemoryPanelTheme,
} from "./memory-panel";

export type InboxOverlayAction = "approve" | "review" | "skip" | null;

export interface InboxOverlayOptions {
  candidates: CaptureCandidate[];
  autoEligibleCount: number;
  highThreshold: number;
}

export function shouldPromptForInbox(
  candidates: CaptureCandidate[],
  options: { batchThreshold: number; singletonDirectReview: boolean },
): boolean {
  if (candidates.length >= options.batchThreshold) return true;
  if (!options.singletonDirectReview) return false;
  return candidates.some((candidate) => [
    "direct_user_instruction",
    "user_correction",
    "repeated_user_preference",
  ].includes(candidate.primary_trust_class ?? ""));
}

// Compatibility alias retained for tests and external callers.
export function themeFromInbox(theme: unknown): MemoryPanelTheme {
  return createMemoryPanelTheme(theme);
}

// ─── Actions ─────────────────────────────────────────────────────────────────

const ACTIONS = [
  { key: "a", idx: 0 as const, action: "approve" as InboxOverlayAction },
  { key: "r", idx: 1 as const, action: "review"  as InboxOverlayAction },
  { key: "s", idx: 2 as const, action: "skip"    as InboxOverlayAction },
];

// ─── Component ────────────────────────────────────────────────────────────────

export class InboxReviewOverlay {
  focused = false;
  private cursor: 0 | 1 | 2 = 0; // which action is highlighted

  constructor(
    private opts: InboxOverlayOptions,
    private th: MemoryPanelTheme,
    private done: (action: InboxOverlayAction) => void,
  ) {}

  handleInput(data: string): void {
    const lower = data.toLowerCase();

    // Single-letter shortcuts — immediate resolve regardless of cursor
    if (lower === "a") { this.done("approve"); return; }
    if (lower === "r") { this.done("review");  return; }
    if (lower === "s") { this.done("skip");    return; }

    // Dismiss
    if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
      this.done(null);
      return;
    }

    // Arrow / tab navigation
    if (matchesKey(data, "left") || matchesKey(data, "up")) {
      this.cursor = Math.max(0, this.cursor - 1) as 0 | 1 | 2;
    } else if (matchesKey(data, "right") || matchesKey(data, "down") || matchesKey(data, "tab")) {
      this.cursor = Math.min(2, this.cursor + 1) as 0 | 1 | 2;
    } else if (matchesKey(data, "return")) {
      this.done(ACTIONS[this.cursor]?.action ?? null);
    }
    // tui.requestRender() is called by the factory wrapper after every input
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    const th = this.th;
    const width = panelWidth(termWidth);
    const count = this.opts.candidates.length;
    const auto = this.opts.autoEligibleCount;
    const lines = [
      renderMemoryPanelSeparator(th, width),
      ...renderMemoryPanelHeader(
        th,
        width,
        "Memory Inbox",
        `${count} candidate${count !== 1 ? "s" : ""} · ${auto} auto-eligible`,
      ),
    ];

    for (const candidate of this.opts.candidates.slice(0, 7)) {
      const isAuto = (candidate.confidence ?? 0) >= this.opts.highThreshold;
      const badge = isAuto ? th.success("✓") : th.warning("~");
      const prefix = `  ${badge}${th.dim(`  conf ${(candidate.confidence ?? 0).toFixed(2)}  `)}`;
      lines.push(...wrapPanelHanging(prefix, th.content(candidate.text), width));
    }
    if (count > 7) lines.push(...wrapPanelLine(th.dim(`  … and ${count - 7} more`), width));
    lines.push("");

    const labels = [`Apply ${auto} auto-eligible`, "Review in detail", "Skip for now"];
    const actions = ACTIONS.map(({ key, idx }) => {
      const label = `[${this.cursor === idx ? key.toUpperCase() : key}] ${labels[idx] ?? ""}`;
      return this.cursor === idx ? th.selected(label) : th.dim(label);
    });
    lines.push(...wrapPanelLine(actions.join(th.dim("   ")), width));
    lines.push(...renderMemoryPanelControls(th, width, ["↑↓ choose", "Enter confirm", "a/r/s shortcuts", "Esc cancel"]));
    lines.push(renderMemoryPanelSeparator(th, width));
    return lines;
  }
}

// ─── Factory (mirrors createPatchReviewComponent) ─────────────────────────────

export interface TuiLike { requestRender(): void; }

/**
 * Create a ComponentLike wrapping InboxReviewOverlay.
 * Calls tui.requestRender() after every input — required for re-renders.
 */
export function createInboxReviewComponent(
  opts: InboxOverlayOptions,
  done: (action: InboxOverlayAction) => void,
  tui: TuiLike,
  theme: unknown,
) {
  const prompt = new InboxReviewOverlay(opts, themeFromInbox(theme), done);
  return {
    get focused() { return prompt.focused; },
    set focused(v: boolean | undefined) { prompt.focused = Boolean(v); },
    render: (width: number) => prompt.render(width),
    invalidate: () => prompt.invalidate(),
    handleInput: (data: string) => {
      prompt.handleInput(data);
      tui.requestRender();     // required — same pattern as createPatchReviewComponent
    },
  };
}

// ─── Headless fallback ────────────────────────────────────────────────────────

export function buildInboxNotification(candidates: CaptureCandidate[], autoEligible: number): string {
  const n = candidates.length;
  return `📬 ${n} memory candidate${n !== 1 ? "s" : ""} pending (${autoEligible} auto-eligible). Run /curate-memory to review.`;
}
