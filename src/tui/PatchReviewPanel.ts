import { CURSOR_MARKER, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { MemoryPatch } from "../types";

export interface ComponentLike {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
  focused?: boolean;
}

type StyleFn = (text: string) => string;

export interface PatchPanelTheme {
  title: StyleFn;
  border: StyleFn;
  dim: StyleFn;
  accent: StyleFn;
  success: StyleFn;
  warning: StyleFn;
  danger: StyleFn;
  label: StyleFn;
  content: StyleFn;
  selected: StyleFn;
  cursor: StyleFn;
  buffer: StyleFn;
}

const sgr = (code: string): StyleFn => (text) => `\x1b[${code}m${text}\x1b[0m`;
const compose = (...fns: StyleFn[]): StyleFn => (text) => fns.reduceRight((value, fn) => fn(value), text);

function defaultTheme(): PatchPanelTheme {
  return {
    title: compose(sgr("1"), sgr("36")),
    border: sgr("90"),
    dim: sgr("90"),
    accent: sgr("36"),
    success: sgr("32"),
    warning: sgr("33"),
    danger: sgr("31"),
    label: compose(sgr("1"), sgr("35")),
    content: sgr("37"),
    selected: compose(sgr("1"), sgr("2"), sgr("36")),
    cursor: sgr("7"),
    buffer: sgr("95"),
  };
}

function themeFromPi(theme: unknown): PatchPanelTheme {
  const fallback = defaultTheme();
  const maybe = theme as { fg?: (name: string, text: string) => string; bold?: (text: string) => string } | undefined;
  if (!maybe || typeof maybe.fg !== "function") return fallback;
  const fg = (name: string, fb: StyleFn): StyleFn => (text) => {
    try { return maybe.fg?.(name, text) ?? fb(text); } catch { return fb(text); }
  };
  const bold: StyleFn = (text) => {
    try { return maybe.bold?.(text) ?? sgr("1")(text); } catch { return sgr("1")(text); }
  };
  return {
    title: compose(bold, fg("accent", fallback.title)),
    border: fg("dim", fallback.border),
    dim: fg("dim", fallback.dim),
    accent: fg("accent", fallback.accent),
    success: fg("success", fallback.success),
    warning: fg("warning", fallback.warning),
    danger: fg("error", fallback.danger),
    label: compose(bold, fg("accent", fallback.label)),
    content: fg("text", fallback.content),
    selected: compose(bold, fg("accent", fallback.selected), sgr("2")),
    cursor: fallback.cursor,
    buffer: fg("warning", fallback.buffer),
  };
}

function fit(line: string, width: number): string {
  if (width <= 0) return "";
  return truncateToWidth(line, width, "…", true);
}

function wrapLine(line: string, width: number): string[] {
  if (width <= 0) return [""];
  return wrapTextWithAnsi(line, width).flatMap((part) => part === "" ? [""] : [fit(part, width)]);
}

function wrapHanging(prefix: string, text: string, width: number): string[] {
  const prefixWidth = visibleWidth(prefix);
  const bodyWidth = Math.max(1, width - prefixWidth);
  const wrapped = wrapLine(text, bodyWidth);
  if (wrapped.length === 0) return [prefix];
  const continuation = " ".repeat(prefixWidth);
  return wrapped.map((line, index) => index === 0 ? `${prefix}${line}` : `${continuation}${line}`);
}

function riskStyle(theme: PatchPanelTheme, risk: string): StyleFn {
  if (risk === "high") return theme.danger;
  if (risk === "medium") return theme.warning;
  return theme.success;
}

export interface TuiLike {
  requestRender(): void;
}

export function createPatchReviewComponent(
  patch: MemoryPatch,
  done: (selectedOpIds: string[] | null) => void,
  tui: TuiLike,
  editStatement?: (current: string, opId: string) => string | null,
  theme?: unknown,
): ComponentLike {
  const panel = new PatchReviewPanel(patch, done, editStatement, themeFromPi(theme));
  return {
    get focused() { return panel.focused; },
    set focused(value: boolean | undefined) { panel.focused = Boolean(value); },
    render: (width: number) => panel.render(width),
    invalidate: () => panel.invalidate(),
    handleInput: (data: string) => {
      panel.handleInput(data);
      tui.requestRender();
    },
  };
}

export class PatchReviewPanel implements ComponentLike {
  private cursor = 0;
  private selected: Set<string>;
  private editing = false;
  private editBuffer = "";
  private editCursor = 0;
  focused = false;

  constructor(
    private patch: MemoryPatch,
    private done: (selectedOpIds: string[] | null) => void,
    private editStatement?: (current: string, opId: string) => string | null,
    private theme: PatchPanelTheme = defaultTheme(),
  ) {
    this.selected = new Set(patch.ops.filter((op) => op.default_selected).map((op) => op.op_id));
  }

  getSelectedOpIds(): string[] {
    return this.patch.ops.map((op) => op.op_id).filter((id) => this.selected.has(id));
  }

  editHighlightedStatement(statement: string): boolean {
    const op = this.patch.ops[this.cursor];
    if (!op) return false;
    if (op.record) {
      op.record.statement = statement;
      return true;
    }
    if (op.to_record) {
      op.to_record.statement = statement;
      return true;
    }
    return false;
  }

  private renderEditBuffer(width: number): string[] {
    const before = this.editBuffer.slice(0, this.editCursor);
    const at = this.editBuffer[this.editCursor] ?? " ";
    const after = this.editBuffer.slice(this.editCursor + (this.editBuffer[this.editCursor] ? 1 : 0));
    const marker = this.focused ? CURSOR_MARKER : "";
    const prefix = `${this.theme.label("Edit buffer")} ${this.theme.border("│")} `;
    const visual = `${this.theme.buffer(before)}${marker}${this.theme.cursor(at)}${this.theme.buffer(after)}`;
    return wrapHanging(prefix, visual, width);
  }

  render(width: number): string[] {
    const selectedCount = this.selected.size;
    const skippedCount = this.patch.ops.length - selectedCount;
    const outerDivider = this.theme.border("─".repeat(Math.max(1, width)));
    const pad = " ";
    const padWidth = visibleWidth(pad);
    const contentWidth = Math.max(1, width - (padWidth * 2));
    const lines: string[] = [outerDivider];
    const push = (line = "") => {
      if (line === "") {
        lines.push("");
        return;
      }
      for (const wrapped of wrapLine(line, contentWidth)) lines.push(`${pad}${wrapped}${pad}`);
    };
    const pushRaw = (line: string) => lines.push(line);

    push(this.theme.title(`Memory Curator — ${this.patch.patch_id}`));
    push(`${this.theme.accent(`${selectedCount} selected`)} ${this.theme.dim("·")} ${this.theme.dim(`${skippedCount} skipped`)}`);
    push(this.editing
      ? `${this.theme.warning("EDITING")} ${this.theme.dim("·")} ${this.theme.accent("type")} ${this.theme.dim("·")} ${this.theme.accent("←/→")} move cursor ${this.theme.dim("·")} ${this.theme.accent("ctrl+u")} clear ${this.theme.dim("·")} ${this.theme.accent("enter")} save ${this.theme.dim("·")} ${this.theme.accent("esc")} cancel edit`
      : `${this.theme.accent("↑↓")} move ${this.theme.dim("·")} ${this.theme.accent("space")} toggle ${this.theme.dim("·")} ${this.theme.accent("e")} edit ${this.theme.dim("·")} ${this.theme.accent("enter")} apply ${this.theme.dim("·")} ${this.theme.accent("q/ctrl+c")} cancel`);
    push();
    if (this.editing) {
      for (const line of this.renderEditBuffer(contentWidth)) push(line);
      push();
    }
    for (let i = 0; i < this.patch.ops.length; i++) {
      const op = this.patch.ops[i];
      const isCursor = i === this.cursor;
      const rowMarker = isCursor ? "▶" : " ";
      const checked = this.selected.has(op.op_id) ? this.theme.success("✓") : this.theme.dim(" ");
      const risk = riskStyle(this.theme, op.risk)(op.risk);
      const header = `${rowMarker} [${checked}] ${this.theme.label(op.op_id)} ${this.theme.accent(op.op.toUpperCase())} ${this.theme.dim("risk:")}${risk}`;
      push(isCursor ? this.theme.selected(header) : header);
      if (op.rationale) {
        for (const line of wrapHanging(`    ${this.theme.dim("why:")} `, this.theme.content(op.rationale), contentWidth)) push(line);
      }
      const statement = op.record?.statement ?? op.to_record?.statement;
      if (statement) {
        for (const line of wrapHanging(`    ${this.theme.dim("statement:")} `, this.theme.content(statement), contentWidth)) push(line);
      }
      if (i < this.patch.ops.length - 1) push();
    }
    pushRaw(outerDivider);
    return lines;
  }

  handleInput(data: string): void {
    if (this.editing) {
      if (matchesKey(data, Key.escape)) {
        this.editing = false;
        this.editBuffer = "";
      } else if (matchesKey(data, Key.enter)) {
        this.editHighlightedStatement(this.editBuffer);
        this.editing = false;
        this.editBuffer = "";
      } else if (matchesKey(data, Key.ctrl("u"))) {
        this.editBuffer = "";
        this.editCursor = 0;
      } else if (matchesKey(data, Key.left)) {
        this.editCursor = Math.max(0, this.editCursor - 1);
      } else if (matchesKey(data, Key.right)) {
        this.editCursor = Math.min(this.editBuffer.length, this.editCursor + 1);
      } else if (matchesKey(data, Key.home)) {
        this.editCursor = 0;
      } else if (matchesKey(data, Key.end)) {
        this.editCursor = this.editBuffer.length;
      } else if (matchesKey(data, Key.backspace)) {
        if (this.editCursor > 0) {
          this.editBuffer = `${this.editBuffer.slice(0, this.editCursor - 1)}${this.editBuffer.slice(this.editCursor)}`;
          this.editCursor--;
        }
      } else if (data.length === 1 && data >= " ") {
        this.editBuffer = `${this.editBuffer.slice(0, this.editCursor)}${data}${this.editBuffer.slice(this.editCursor)}`;
        this.editCursor++;
      }
      return;
    }

    if (matchesKey(data, Key.up)) this.cursor = Math.max(0, this.cursor - 1);
    else if (matchesKey(data, Key.down)) this.cursor = Math.min(this.patch.ops.length - 1, this.cursor + 1);
    else if (matchesKey(data, Key.space)) {
      const id = this.patch.ops[this.cursor]?.op_id;
      if (id) this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
    } else if (matchesKey(data, "e")) {
      const op = this.patch.ops[this.cursor];
      const current = op?.record?.statement ?? op?.to_record?.statement;
      if (!op || current === undefined) return;
      if (this.editStatement) {
        const next = this.editStatement(current, op.op_id);
        if (next !== null) this.editHighlightedStatement(next);
      } else {
        this.editing = true;
        this.editBuffer = current;
        this.editCursor = current.length;
      }
    } else if (matchesKey(data, Key.enter)) {
      this.done(this.getSelectedOpIds());
    } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || matchesKey(data, "q")) {
      this.done(null);
    }
  }

  invalidate(): void {}
}
