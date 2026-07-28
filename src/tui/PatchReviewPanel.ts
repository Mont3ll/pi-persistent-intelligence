import { CURSOR_MARKER, Key, matchesKey } from "@earendil-works/pi-tui";
import type { MemoryPatch } from "../types";
import {
  createMemoryPanelTheme,
  panelWidth,
  renderCursorMarker,
  renderMemoryPanelControls,
  renderMemoryPanelHeader,
  renderMemoryPanelSeparator,
  wrapPanelHanging,
  wrapPanelLine,
  type MemoryPanelTheme,
} from "./memory-panel";

export interface ComponentLike {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
  focused?: boolean;
}

type StyleFn = (text: string) => string;
export type PatchPanelTheme = MemoryPanelTheme;

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
  const panel = new PatchReviewPanel(patch, done, editStatement, createMemoryPanelTheme(theme));
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
    private theme: PatchPanelTheme = createMemoryPanelTheme(undefined),
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
    const prefix = `${this.theme.label("Edit buffer")} ${this.theme.dim("│")} `;
    const visual = `${this.theme.buffer(before)}${marker}${this.theme.cursor(at)}${this.theme.buffer(after)}`;
    return wrapPanelHanging(prefix, visual, width);
  }

  render(width: number): string[] {
    const boundedWidth = panelWidth(width);
    const selectedCount = this.selected.size;
    const skippedCount = this.patch.ops.length - selectedCount;
    const lines = [
      renderMemoryPanelSeparator(this.theme, boundedWidth),
      "",
      ...renderMemoryPanelHeader(
        this.theme,
        boundedWidth,
        "Memory Curator",
        `${this.patch.patch_id} · ${selectedCount} selected · ${skippedCount} skipped`,
      ),
    ];

    if (this.editing) {
      lines.push(...this.renderEditBuffer(boundedWidth));
      lines.push("");
    }

    for (let i = 0; i < this.patch.ops.length; i++) {
      const op = this.patch.ops[i];
      const isCursor = i === this.cursor;
      const marker = renderCursorMarker(this.theme, isCursor);
      const checked = this.selected.has(op.op_id) ? this.theme.success("✓") : this.theme.dim(" ");
      const risk = riskStyle(this.theme, op.risk)(op.risk);
      const header = `${marker} [${checked}] ${this.theme.label(op.op_id)} ${this.theme.accent(op.op.toUpperCase())} ${this.theme.dim("risk:")} ${risk}`;
      lines.push(...wrapPanelLine(isCursor ? this.theme.selected(header) : header, boundedWidth));
      if (op.rationale) lines.push(...wrapPanelHanging(`    ${this.theme.dim("why:")} `, this.theme.content(op.rationale), boundedWidth));
      const statement = op.record?.statement ?? op.to_record?.statement;
      if (statement) lines.push(...wrapPanelHanging(`    ${this.theme.dim("statement:")} `, this.theme.content(statement), boundedWidth));
      if (i < this.patch.ops.length - 1) lines.push("");
    }

    lines.push("");
    lines.push(...renderMemoryPanelControls(
      this.theme,
      boundedWidth,
      this.editing
        ? ["EDITING", "type", "←→ move", "Ctrl+U clear", "Enter save", "Esc cancel"]
        : ["↑↓ move", "Space toggle", "e edit", "Enter apply", "Esc cancel"],
    ));
    lines.push("");
    lines.push(renderMemoryPanelSeparator(this.theme, boundedWidth));
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
