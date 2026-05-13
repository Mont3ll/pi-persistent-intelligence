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

import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CaptureCandidate } from "../types";

export type InboxOverlayAction = "approve" | "review" | "skip" | null;

export interface InboxOverlayOptions {
  candidates: CaptureCandidate[];
  autoEligibleCount: number;
  highThreshold: number;
}

// ─── Theme (mirrors PatchReviewPanel's PatchPanelTheme) ───────────────────────

type StyleFn = (text: string) => string;

interface InboxTheme {
  title:    StyleFn;   // bold accent  — header text
  border:   StyleFn;   // dim          — separator lines
  dim:      StyleFn;   // dim          — secondary info, unselected actions
  accent:   StyleFn;   // accent       — highlighted action label
  success:  StyleFn;   // success      — ✓ auto-eligible badge  (= PatchReviewPanel selected ✓)
  warning:  StyleFn;   // warning      — ~ needs-review badge   (= PatchReviewPanel warning)
  content:  StyleFn;   // text         — candidate statement    (= PatchReviewPanel content)
  selected: StyleFn;   // bold accent  — focused action bracket (= PatchReviewPanel selected)
}

const sgr = (code: string): StyleFn => (text) => `\x1b[${code}m${text}\x1b[0m`;
const compose = (...fns: StyleFn[]): StyleFn => (text) => fns.reduceRight((v, fn) => fn(v), text);

function defaultInboxTheme(): InboxTheme {
  return {
    title:    compose(sgr("1"), sgr("36")),   // bold cyan
    border:   sgr("90"),                       // dim grey
    dim:      sgr("90"),                       // dim grey
    accent:   sgr("36"),                       // cyan
    success:  sgr("32"),                       // green
    warning:  sgr("33"),                       // amber
    content:  sgr("37"),                       // white/light grey
    selected: compose(sgr("1"), sgr("36")),   // bold cyan
  };
}

/**
 * Build InboxTheme from pi's raw theme object.
 * Mirrors PatchReviewPanel's themeFromPi — identical color-name lookups
 * so both panels use the same resolved colors from the user's pi theme.
 */
export function themeFromInbox(theme: unknown): InboxTheme {
  const fallback = defaultInboxTheme();
  const maybe = theme as { fg?: (name: string, text: string) => string; bold?: (text: string) => string } | undefined;
  if (!maybe || typeof maybe.fg !== "function") return fallback;

  const fg = (name: string, fb: StyleFn): StyleFn => (text) => {
    try { return maybe.fg?.(name, text) ?? fb(text); } catch { return fb(text); }
  };
  const bold: StyleFn = (text) => {
    try { return maybe.bold?.(text) ?? sgr("1")(text); } catch { return sgr("1")(text); }
  };

  return {
    title:    compose(bold, fg("accent",  fallback.accent)),
    border:   fg("dim",     fallback.border),
    dim:      fg("dim",     fallback.dim),
    accent:   fg("accent",  fallback.accent),
    success:  fg("success", fallback.success),
    warning:  fg("warning", fallback.warning),
    content:  fg("text",    fallback.content),
    selected: compose(bold, fg("accent",  fallback.selected)),
  };
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
    private th: InboxTheme,
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
    const W = Math.max(60, termWidth > 0 ? termWidth : 80);
    const sep = th.border("─".repeat(W));
    const lines: string[] = [];

    // ── Header ─────────────────────────────────────────────────────────────────
    // Mirrors PatchReviewPanel: title on left, stats right-aligned
    const n = this.opts.candidates.length;
    const auto = this.opts.autoEligibleCount;
    const titlePart   = th.title(`  📬 Memory Inbox`);
    const statsPart   = th.dim(`${n} candidate${n !== 1 ? "s" : ""}  ·  ${auto} auto-eligible  `);
    const titleW = visibleWidth(titlePart);
    const statsW = visibleWidth(statsPart);
    const gap = Math.max(1, W - titleW - statsW);
    lines.push(titlePart + " ".repeat(gap) + statsPart);
    lines.push(sep);
    lines.push("");

    // ── Candidate rows ─────────────────────────────────────────────────────────
    // ✓ = success (green, same as PatchReviewPanel selected checkbox)
    // ~ = warning (amber, same as PatchReviewPanel warning/medium-risk)
    const maxStmt = Math.max(20, W - 20);
    const shown = this.opts.candidates.slice(0, 7);
    for (const c of shown) {
      const isAuto = (c.confidence ?? 0) >= this.opts.highThreshold;
      const badge   = isAuto ? th.success("✓") : th.warning("~");
      const conf    = th.dim(`  conf ${(c.confidence ?? 0).toFixed(2)}  `);
      const stmt    = th.content(truncateToWidth(c.text, maxStmt));
      lines.push(`  ${badge}${conf}${stmt}`);
    }
    if (this.opts.candidates.length > 7) {
      lines.push(th.dim(`  … and ${this.opts.candidates.length - 7} more`));
    }
    lines.push("");
    lines.push(sep);

    // ── Action row ─────────────────────────────────────────────────────────────
    // Mirrors PatchReviewPanel footer: bold accent for active, dim for inactive
    const autoCount = this.opts.autoEligibleCount;
    const labels = [
      `Apply ${autoCount} auto-eligible`,
      "Review in detail",
      "Skip for now",
    ];
    const actionParts = ACTIONS.map(({ key, idx }) => {
      const label = labels[idx] ?? "";
      return this.cursor === idx
        ? th.selected(`[${key.toUpperCase()}] ${label}`)  // highlighted: bold accent
        : th.dim(`[${key}] ${label}`);                     // inactive: dim
    });
    lines.push("  " + actionParts.join(th.dim("   ")));
    lines.push(th.dim("  a · r · s  or  ←→ navigate + Enter  ·  Esc dismiss"));
    lines.push("");

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
