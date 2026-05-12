/**
 * InboxReviewPrompt — inline prompt for inbox curation.
 *
 * Triggered automatically before the first agent turn when pending inbox
 * candidates exceed the configured threshold. Renders in the prompt/editor
 * area (same as /curate-memory's PatchReviewPanel), not as a floating overlay.
 * Escape / 's' dismisses cleanly without blocking the session.
 *
 * Return values:
 *   "approve"  — apply auto-eligible ops immediately
 *   "review"   — user should run /curate-memory for the full panel
 *   "skip"     — dismiss; candidates stay in inbox
 *   null       — Escape / cancelled
 */

import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CaptureCandidate } from "../types";

export type InboxOverlayAction = "approve" | "review" | "skip" | null;

export interface InboxOverlayOptions {
  candidates: CaptureCandidate[];
  autoEligibleCount: number;       // how many will be auto-applied on "approve"
  highThreshold: number;           // confidence threshold for auto-eligible display
}

type StyleFn = (text: string) => string;

export interface OverlayTheme {
  border: StyleFn;
  title: StyleFn;
  accent: StyleFn;
  success: StyleFn;
  warning: StyleFn;
  dim: StyleFn;
}

function fallbackTheme(): OverlayTheme {
  return {
    border: (s) => s,
    title: (s) => s,
    accent: (s) => s,
    success: (s) => s,
    warning: (s) => s,
    dim: (s) => s,
  };
}

export class InboxReviewOverlay {
  focused = false;

  private selected: 0 | 1 | 2 = 0; // 0=approve, 1=review, 2=skip

  constructor(
    private opts: InboxOverlayOptions,
    private theme: OverlayTheme | undefined,
    private done: (action: InboxOverlayAction) => void,
  ) {}

  private get th(): OverlayTheme {
    return this.theme ?? fallbackTheme();
  }

  handleInput(data: string): void {
    // Direct keyboard shortcuts (permission-prompt style)
    if (data === "a" || data === "A") { this.done("approve"); return; }
    if (data === "r" || data === "R") { this.done("review"); return; }
    if (data === "s" || data === "S") { this.done("skip"); return; }
    if (matchesKey(data, "escape")) { this.done(null); return; }

    // Arrow navigation + enter
    if (matchesKey(data, "left") || matchesKey(data, "up")) {
      this.selected = Math.max(0, this.selected - 1) as 0 | 1 | 2;
    } else if (matchesKey(data, "right") || matchesKey(data, "down")) {
      this.selected = Math.min(2, this.selected + 1) as 0 | 1 | 2;
    } else if (matchesKey(data, "return")) {
      const actions: InboxOverlayAction[] = ["approve", "review", "skip"];
      this.done(actions[this.selected] ?? null);
    }
  }

  invalidate(): void { /* pi TUI calls this to signal re-render */ }

  render(termWidth: number): string[] {
    const th = this.th;
    // Fill the editor area width, same as PatchReviewPanel. Clamp to a readable range.
    const W = Math.max(60, Math.min(termWidth > 0 ? termWidth : 80, 120));
    const inner = W - 2;

    const pad = (text: string, len = inner): string => {
      const vis = visibleWidth(text);
      return text + " ".repeat(Math.max(0, len - vis));
    };

    const row = (content: string): string =>
      th.border("│") + pad(` ${content}`, inner) + th.border("│");

    const divider = th.border(`├${"─".repeat(inner)}┤`);
    const lines: string[] = [];

    // ── Header ──────────────────────────────────────────────────────
    const count = this.opts.candidates.length;
    const headerText = `📬 Memory Inbox  ${th.dim(`(${count} candidate${count !== 1 ? "s" : ""} pending)`)}`;
    lines.push(th.border(`╭${"─".repeat(inner)}╮`));
    lines.push(row(th.title(headerText)));
    lines.push(divider);

    // ── Candidate list (max 6 shown) ─────────────────────────────────
    const shown = this.opts.candidates.slice(0, 6);
    for (const c of shown) {
      const isAuto = c.confidence !== undefined && c.confidence >= this.opts.highThreshold;
      const badge = isAuto ? th.success("✓") : th.warning("~");
      const conf = th.dim(`conf ${(c.confidence ?? 0).toFixed(2)}`);
      const stmt = truncateToWidth(c.text, inner - 16);
      lines.push(row(`${badge} ${conf}  ${stmt}`));
    }
    if (this.opts.candidates.length > 6) {
      lines.push(row(th.dim(`  … and ${this.opts.candidates.length - 6} more`)));
    }
    lines.push(row(""));

    // ── Action row ───────────────────────────────────────────────────
    const autoCount = this.opts.autoEligibleCount;
    const actions = [
      { key: "a", label: `Apply ${autoCount} auto-eligible`, idx: 0 },
      { key: "r", label: "Review one-by-one", idx: 1 },
      { key: "s", label: "Skip for now", idx: 2 },
    ];

    const actionStr = actions
      .map(({ key, label, idx }) => {
        const bracket = this.selected === idx
          ? th.accent(`[${key.toUpperCase()}]`)
          : th.dim(`[${key}]`);
        return `${bracket} ${this.selected === idx ? th.accent(label) : th.dim(label)}`;
      })
      .join(th.dim("  "));

    lines.push(row(actionStr));
    lines.push(row(th.dim("↑↓←→ navigate · Enter confirm · Esc dismiss")));
    lines.push(th.border(`╰${"─".repeat(inner)}╯`));

    return lines;
  }
}

/**
 * Build a plain-text fallback for non-UI contexts (print mode, headless).
 * Returns a compact notification string.
 */
export function buildInboxNotification(candidates: CaptureCandidate[], autoEligible: number): string {
  const n = candidates.length;
  return `📬 ${n} memory candidate${n !== 1 ? "s" : ""} in inbox (${autoEligible} auto-eligible). Run /curate-memory to review.`;
}
