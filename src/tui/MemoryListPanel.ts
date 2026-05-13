/**
 * MemoryListPanel — TUI table for browsing and managing L1/L2 memory records.
 *
 * Adapted from pi-code-intelligence's CodeIntelligenceDashboardComponent.
 * Visual style matches PatchReviewPanel and InboxReviewOverlay.
 *
 * Keyboard:
 *   ↑↓      navigate rows
 *   d       deprecate highlighted record
 *   e/Enter expand detail view (inline)
 *   q / Esc close panel
 */

import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { MemoryRecord, MemoryRuleType } from "../types";

// ─── Theme (same as InboxReviewOverlay) ──────────────────────────────────────

type StyleFn = (text: string) => string;

interface ListTheme {
  title:   StyleFn;
  border:  StyleFn;
  dim:     StyleFn;
  accent:  StyleFn;
  success: StyleFn;
  warning: StyleFn;
  danger:  StyleFn;
  content: StyleFn;
  cursor:  StyleFn;
}

const sgr = (code: string): StyleFn => (text) => `\x1b[${code}m${text}\x1b[0m`;
const compose = (...fns: StyleFn[]): StyleFn => (text) => fns.reduceRight((v, fn) => fn(v), text);

function defaultListTheme(): ListTheme {
  return {
    title:   compose(sgr("1"), sgr("36")),
    border:  sgr("90"),
    dim:     sgr("90"),
    accent:  sgr("36"),
    success: sgr("32"),
    warning: sgr("33"),
    danger:  sgr("31"),
    content: sgr("37"),
    cursor:  compose(sgr("1"), sgr("36")),
  };
}

export function themeFromList(theme: unknown): ListTheme {
  const fallback = defaultListTheme();
  const maybe = theme as { fg?: (n: string, t: string) => string; bold?: (t: string) => string } | undefined;
  if (!maybe || typeof maybe.fg !== "function") return fallback;
  const fg = (name: string, fb: StyleFn): StyleFn => (text) => {
    try { return maybe.fg?.(name, text) ?? fb(text); } catch { return fb(text); }
  };
  const bold: StyleFn = (text) => {
    try { return maybe.bold?.(text) ?? sgr("1")(text); } catch { return sgr("1")(text); }
  };
  return {
    title:   compose(bold, fg("accent",   fallback.accent)),
    border:  fg("dim",     fallback.border),
    dim:     fg("dim",     fallback.dim),
    accent:  fg("accent",  fallback.accent),
    success: fg("success", fallback.success),
    warning: fg("warning", fallback.warning),
    danger:  fg("error",   fallback.danger),
    content: fg("text",    fallback.content),
    cursor:  compose(bold, fg("accent",   fallback.cursor)),
  };
}

// ─── Action result ────────────────────────────────────────────────────────────

export interface ListPanelResult {
  action: "deprecate";
  recordId: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysSince(dateStr: string): number {
  try {
    const then = new Date(dateStr).getTime();
    return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  } catch { return 0; }
}

function ageLabel(days: number): string {
  if (days === 0) return "today";
  if (days < 7)   return `${days}d`;
  if (days < 30)  return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

const RULE_SHORT: Record<MemoryRuleType, string> = {
  workflow:        "workflow",
  preference:      "pref",
  convention:      "conv",
  architecture:    "arch",
  avoid_pattern:   "avoid",
  prefer_pattern:  "prefer",
  testing:         "test",
  correction:      "fix",
  tool:            "tool",
};

function ruleShort(ruleType?: MemoryRuleType): string {
  return ruleType ? (RULE_SHORT[ruleType] ?? ruleType.slice(0, 6)) : "—";
}

// ─── Component ────────────────────────────────────────────────────────────────

export class MemoryListPanel {
  focused = false;
  private cursor = 0;
  private expandedId: string | null = null;

  constructor(
    private records: MemoryRecord[],
    private done: (result: ListPanelResult | null) => void,
    private th: ListTheme,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "up"))   { this.cursor = Math.max(0, this.cursor - 1); return; }
    if (matchesKey(data, "down")) { this.cursor = Math.min(this.records.length - 1, this.cursor + 1); return; }
    if (matchesKey(data, "escape") || matchesKey(data, "q")) { this.done(null); return; }

    if (matchesKey(data, "return") || data === "e" || data === "E") {
      const rec = this.records[this.cursor];
      this.expandedId = this.expandedId === rec?.id ? null : (rec?.id ?? null);
      return;
    }

    if (data === "d" || data === "D") {
      const rec = this.records[this.cursor];
      if (rec) this.done({ action: "deprecate", recordId: rec.id });
      return;
    }
  }

  invalidate(): void {}

  render(termWidth: number): string[] {
    const th = this.th;
    const W = Math.max(60, termWidth > 0 ? termWidth : 80);
    const sep = th.border("─".repeat(W));
    const lines: string[] = [];

    // ── Header ─────────────────────────────────────────────────────────────────
    const active = this.records.filter((r) => r.status === "active");
    const stale = active.filter((r) => daysSince(r.updated_at) >= 30).length;
    const l1count = active.filter((r) => r.layer === "L1").length;
    const l2count = active.filter((r) => r.layer === "L2").length;
    const headerTitle = th.title("  📋 Long-Term Memory");
    const headerStats = th.dim(`L1: ${l1count}  ·  L2: ${l2count}  ·  ${stale > 0 ? `${stale} stale  ` : "0 stale  "}`);
    const gap = Math.max(1, W - visibleWidth(headerTitle) - visibleWidth(headerStats));
    lines.push(headerTitle + " ".repeat(gap) + headerStats);
    lines.push(sep);

    // ── Column headers ──────────────────────────────────────────────────────────
    const COL_LAYER = 6;
    const COL_TYPE  = 8;
    const COL_CONF  = 7;
    const COL_STALE = 6;
    const COL_AGE   = 5;
    const COL_STMT  = Math.max(20, W - COL_LAYER - COL_TYPE - COL_CONF - COL_STALE - COL_AGE - 6);

    const pad = (s: string, n: number): string => {
      const v = visibleWidth(s);
      return v >= n ? s : s + " ".repeat(n - v);
    };
    lines.push(
      th.dim("  " +
        pad("Layer", COL_LAYER) + " " +
        pad("Type",  COL_TYPE)  + " " +
        pad("Conf",  COL_CONF)  + " " +
        pad("Age",   COL_AGE)   + "  " +
        "Statement",
      ),
    );
    lines.push(sep);

    // ── Rows ────────────────────────────────────────────────────────────────────
    if (this.records.length === 0) {
      lines.push(th.dim("  No memory records."));
    }

    for (let i = 0; i < this.records.length; i++) {
      const r = this.records[i];
      const isCursor = i === this.cursor;
      const days = daysSince(r.updated_at);
      const isStale = days >= 90;
      const isWarning = days >= 30 && days < 90;

      const layerStr  = pad(r.layer, COL_LAYER);
      const typeStr   = pad(ruleShort(r.ruleType), COL_TYPE);
      const confStr   = pad(r.confidence.toFixed(2), COL_CONF);
      const ageStr    = pad(ageLabel(days), COL_AGE);
      const stmtStr   = truncateToWidth(r.statement, COL_STMT);

      const staleIndicator = isStale ? th.danger("🔴") : isWarning ? th.warning("⚠️ ") : "   ";

      const marker = isCursor ? "▶" : " ";
      const rowContent =
        `${marker} ${layerStr} ${typeStr} ${confStr} ${staleIndicator}${ageStr}  ${stmtStr}`;

      lines.push(isCursor ? th.cursor(rowContent) : th.content(rowContent));

      // Expanded detail view
      if (this.expandedId === r.id) {
        lines.push(th.dim(`    ID: ${r.id}`));
        lines.push(th.dim(`    Evidence: ${r.evidence.map((e) => e.ref).join(", ")}`));
        lines.push(th.dim(`    Tags: ${r.tags.join(", ")}`));
        lines.push(th.dim(`    Review: ${r.review.next_review}  ·  ${r.review.change_condition.slice(0, 60)}`));
        if (r.vault_ref) lines.push(th.dim(`    Vault: ${r.vault_ref}`));
      }
    }

    // ── Footer ──────────────────────────────────────────────────────────────────
    lines.push(sep);
    const pos = this.records.length > 0 ? `cursor: ${this.cursor + 1}/${this.records.length}` : "empty";
    lines.push(th.dim(`  ↑↓ navigate  e expand  d deprecate  q close    ${pos}`));
    lines.push("");

    return lines;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createMemoryListComponent(
  records: MemoryRecord[],
  done: (result: ListPanelResult | null) => void,
  tui: { requestRender(): void },
  theme: unknown,
) {
  const panel = new MemoryListPanel(records, done, themeFromList(theme));
  return {
    get focused() { return panel.focused; },
    set focused(v: boolean | undefined) { panel.focused = Boolean(v); },
    render: (width: number) => panel.render(width),
    invalidate: () => panel.invalidate(),
    handleInput: (data: string) => {
      panel.handleInput(data);
      tui.requestRender();
    },
  };
}
