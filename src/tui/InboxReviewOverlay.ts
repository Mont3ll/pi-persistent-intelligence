/**
 * InboxReviewPrompt — inline prompt for inbox curation.
 *
 * Renders in the prompt/editor area (same as /curate-memory's PatchReviewPanel).
 * No floating overlay, no box-drawing characters.
 * Top/bottom separators, whitespace, and colored text for visual hierarchy.
 *
 * Return values:
 *   "approve"  — apply auto-eligible ops immediately
 *   "review"   — open full PatchReviewPanel for per-op selection
 *   "skip"     — dismiss; candidates stay in inbox
 *   null       — Escape / cancelled
 */

import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CaptureCandidate } from "../types";

export type InboxOverlayAction = "approve" | "review" | "skip" | null;

export interface InboxOverlayOptions {
  candidates: CaptureCandidate[];
  autoEligibleCount: number;
  highThreshold: number;
}

type StyleFn = (text: string) => string;

export interface OverlayTheme {
  border: StyleFn;
  title: StyleFn;
  accent: StyleFn;
  success: StyleFn;
  warning: StyleFn;
  dim: StyleFn;
  content: StyleFn;
  selected: StyleFn;
}

function fallbackTheme(): OverlayTheme {
  return {
    border: (s) => s,
    title: (s) => s,
    accent: (s) => s,
    success: (s) => s,
    warning: (s) => s,
    dim: (s) => s,
    content: (s) => s,
    selected: (s) => s,
  };
}

// ─── Action definitions ───────────────────────────────────────────────────────

const ACTIONS = [
  { key: "a", label: "Apply auto-eligible", idx: 0 },
  { key: "r", label: "Review one-by-one",   idx: 1 },
  { key: "s", label: "Skip for now",         idx: 2 },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export class InboxReviewOverlay {
  focused = false;
  private selected: 0 | 1 | 2 = 0;

  constructor(
    private opts: InboxOverlayOptions,
    private theme: OverlayTheme | undefined,
    private done: (action: InboxOverlayAction) => void,
  ) {}

  private get th(): OverlayTheme {
    return this.theme ?? fallbackTheme();
  }

  // ─── Input handling ──────────────────────────────────────────────────────────

  handleInput(data: string): void {
    // Direct letter shortcuts — single keypress immediately resolves
    const lower = data.toLowerCase();
    if (lower === "a") { this.done("approve"); return; }
    if (lower === "r") { this.done("review");  return; }
    if (lower === "s") { this.done("skip");    return; }

    if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
      this.done(null);
      return;
    }

    // Arrow / tab navigation (changes which action is highlighted)
    if (matchesKey(data, "left") || matchesKey(data, "up")) {
      this.selected = Math.max(0, this.selected - 1) as 0 | 1 | 2;
    } else if (matchesKey(data, "right") || matchesKey(data, "down") || matchesKey(data, "tab")) {
      this.selected = Math.min(2, this.selected + 1) as 0 | 1 | 2;
    } else if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      const actions: InboxOverlayAction[] = ["approve", "review", "skip"];
      this.done(actions[this.selected] ?? null);
    }
    // Note: caller (the factory wrapper in index.ts) calls tui.requestRender() after every input
  }

  invalidate(): void {}

  // ─── Rendering ───────────────────────────────────────────────────────────────

  render(termWidth: number): string[] {
    const th = this.th;
    const W = Math.max(60, Math.min(termWidth > 0 ? termWidth : 80, 140));
    const sep = th.border("─".repeat(W));
    const lines: string[] = [];

    // ── Header ─────────────────────────────────────────────────────────────────
    const count = this.opts.candidates.length;
    const auto = this.opts.autoEligibleCount;
    const titleText = th.title("  📬  Memory Inbox");
    const statsText = th.dim(`${count} candidate${count !== 1 ? "s" : ""}  ·  ${auto} auto-eligible  `);
    const titleVis = visibleWidth(titleText);
    const statsVis = visibleWidth(statsText);
    const gap = Math.max(1, W - titleVis - statsVis);
    lines.push(titleText + " ".repeat(gap) + statsText);
    lines.push(sep);
    lines.push("");

    // ── Candidates ─────────────────────────────────────────────────────────────
    const contentWidth = W - 18; // badge(2) + conf(10) + spacing
    const shown = this.opts.candidates.slice(0, 7);
    for (const c of shown) {
      const isAuto = (c.confidence ?? 0) >= this.opts.highThreshold;
      const badge = isAuto ? th.success("✓") : th.warning("~");
      const conf = th.dim(`  conf ${(c.confidence ?? 0).toFixed(2)}  `);
      const stmt = th.content(truncateToWidth(c.text, Math.max(20, contentWidth)));
      lines.push(`  ${badge}${conf}${stmt}`);
    }
    if (this.opts.candidates.length > 7) {
      lines.push(th.dim(`  … and ${this.opts.candidates.length - 7} more`));
    }
    lines.push("");

    // ── Action row ─────────────────────────────────────────────────────────────
    lines.push(sep);
    const autoCount = this.opts.autoEligibleCount;
    const actionParts = ACTIONS.map(({ key, label, idx }) => {
      const isSelected = this.selected === idx;
      const displayLabel = idx === 0 ? `Apply ${autoCount}` : label;
      if (isSelected) {
        return th.accent(`[${key.toUpperCase()}] ${displayLabel}`);
      }
      return th.dim(`[${key}] ${displayLabel}`);
    });
    lines.push("  " + actionParts.join(th.dim("   ")));
    lines.push(th.dim("  ←→ navigate · Enter confirm · Esc cancel"));
    lines.push("");

    return lines;
  }
}

// ─── Factory wrapper ──────────────────────────────────────────────────────────

/**
 * Create a ComponentLike wrapper that calls tui.requestRender() after every
 * input — required for re-renders to happen as the user navigates actions.
 */
export function createInboxReviewComponent(
  opts: InboxOverlayOptions,
  done: (action: InboxOverlayAction) => void,
  tui: { requestRender(): void },
  theme?: OverlayTheme,
) {
  const prompt = new InboxReviewOverlay(opts, theme, done);
  return {
    get focused() { return prompt.focused; },
    set focused(v: boolean | undefined) { prompt.focused = Boolean(v); },
    render: (width: number) => prompt.render(width),
    invalidate: () => prompt.invalidate(),
    handleInput: (data: string) => {
      prompt.handleInput(data);
      tui.requestRender();
    },
  };
}

// ─── Plain-text fallback ──────────────────────────────────────────────────────

export function buildInboxNotification(candidates: CaptureCandidate[], autoEligible: number): string {
  const n = candidates.length;
  return `📬 ${n} memory candidate${n !== 1 ? "s" : ""} in inbox (${autoEligible} auto-eligible). Run /curate-memory to review.`;
}
