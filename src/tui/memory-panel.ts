import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

type StyleFn = (text: string) => string;

export interface MemoryPanelTheme {
  title: StyleFn;
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

function defaultMemoryPanelTheme(): MemoryPanelTheme {
  return {
    title: compose(sgr("1"), sgr("36")),
    dim: sgr("90"),
    accent: sgr("36"),
    success: sgr("32"),
    warning: sgr("33"),
    danger: sgr("31"),
    label: compose(sgr("1"), sgr("36")),
    content: sgr("37"),
    selected: compose(sgr("1"), sgr("36")),
    cursor: sgr("7"),
    buffer: sgr("33"),
  };
}

export function createMemoryPanelTheme(theme: unknown): MemoryPanelTheme {
  const fallback = defaultMemoryPanelTheme();
  const maybe = theme as { fg?: (name: string, text: string) => string; bold?: (text: string) => string } | undefined;
  if (!maybe || typeof maybe.fg !== "function") return fallback;

  const fg = (name: string, fallbackStyle: StyleFn): StyleFn => (text) => {
    try { return maybe.fg?.(name, text) ?? fallbackStyle(text); } catch { return fallbackStyle(text); }
  };
  const bold: StyleFn = (text) => {
    try { return maybe.bold?.(text) ?? sgr("1")(text); } catch { return sgr("1")(text); }
  };

  return {
    title: compose(bold, fg("accent", fallback.title)),
    dim: fg("dim", fallback.dim),
    accent: fg("accent", fallback.accent),
    success: fg("success", fallback.success),
    warning: fg("warning", fallback.warning),
    danger: fg("error", fallback.danger),
    label: compose(bold, fg("accent", fallback.label)),
    content: fg("text", fallback.content),
    selected: compose(bold, fg("accent", fallback.selected)),
    cursor: fallback.cursor,
    buffer: fg("warning", fallback.buffer),
  };
}

export function panelWidth(width: number): number {
  return Math.max(1, width > 0 ? Math.floor(width) : 1);
}

export function fitPanelLine(line: string, width: number): string {
  return truncateToWidth(line, panelWidth(width), "…", true);
}

export function wrapPanelLine(line: string, width: number): string[] {
  const boundedWidth = panelWidth(width);
  return wrapTextWithAnsi(line, boundedWidth)
    .map((part) => fitPanelLine(part, boundedWidth));
}

export function wrapPanelHanging(prefix: string, text: string, width: number): string[] {
  const boundedWidth = panelWidth(width);
  const fittedPrefix = fitPanelLine(prefix, boundedWidth);
  const prefixWidth = visibleWidth(fittedPrefix);
  const bodyWidth = Math.max(1, boundedWidth - prefixWidth);
  const body = wrapPanelLine(text, bodyWidth);
  if (body.length === 0) return [fittedPrefix];
  const continuation = " ".repeat(prefixWidth);
  return body.map((line, index) => fitPanelLine(index === 0 ? `${fittedPrefix}${line}` : `${continuation}${line}`, boundedWidth));
}

export function renderMemoryPanelHeader(
  theme: MemoryPanelTheme,
  width: number,
  title: string,
  status: string,
): string[] {
  return [
    ...wrapPanelLine(theme.title(title), width),
    ...wrapPanelLine(theme.dim(status), width),
    "",
  ];
}

export function renderMemoryPanelControls(
  theme: MemoryPanelTheme,
  width: number,
  controls: string[],
): string[] {
  return wrapPanelLine(controls.map((item) => theme.dim(item)).join(theme.dim(" · ")), width);
}

export function renderCursorMarker(theme: MemoryPanelTheme, active: boolean): string {
  return active ? theme.accent("▶") : " ";
}
