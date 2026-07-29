import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type StyleFn = (text: string) => string;

export interface BrowserTheme {
  title: StyleFn;
  border: StyleFn;
  dim: StyleFn;
  accent: StyleFn;
  success: StyleFn;
  warning: StyleFn;
  danger: StyleFn;
  content: StyleFn;
  cursor: StyleFn;
  metadata: StyleFn;
}

const sgr = (code: string): StyleFn => (text) => `\x1b[${code}m${text}\x1b[0m`;
const compose = (...fns: StyleFn[]): StyleFn => (text) => fns.reduceRight((value, fn) => fn(value), text);

export function defaultBrowserTheme(): BrowserTheme {
  return {
    title: compose(sgr("1"), sgr("36")),
    border: sgr("90"),
    dim: sgr("90"),
    accent: sgr("36"),
    success: sgr("32"),
    warning: sgr("33"),
    danger: sgr("31"),
    content: sgr("37"),
    cursor: compose(sgr("1"), sgr("36")),
    metadata: sgr("90"),
  };
}

export function themeFromPi(theme: unknown): BrowserTheme {
  const fallback = defaultBrowserTheme();
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
    content: fg("text", fallback.content),
    cursor: compose(bold, fg("accent", fallback.cursor)),
    metadata: fg("dim", fallback.metadata),
  };
}

export interface BrowserColumn<T> {
  key: string;
  label: string;
  width?: number;
  minWidth?: number;
  priority?: number;
  render: (item: T) => string;
  sortValue?: (item: T) => string | number;
}

export interface BrowserAction<T> {
  key: string;
  label: string;
  action: string;
  run?: (item: T | undefined) => void;
}

export interface BrowserItem<T> {
  id: string;
  item: T;
  searchText: string;
  status?: "healthy" | "warning" | "error" | "info";
  details?: string[];
}

export interface BrowserOptions<T> {
  title: string;
  subtitle?: string;
  items: BrowserItem<T>[];
  columns: BrowserColumn<T>[];
  pageSize?: number;
  detailTitle?: (item: T) => string;
  detailLines?: (item: T) => string[];
  actions?: BrowserAction<T>[];
  sortBy?: string;
  emptyMessage?: string;
  separatorStyle?: "sectioned" | "frame";
  onClose?: (result: BrowserResult<T> | null) => void;
}

export interface BrowserResult<T> {
  action: string;
  id?: string;
  item?: T;
}

function plainWidth(text: string): number { return visibleWidth(text); }
function fit(text: string, width: number): string {
  if (width <= 0) return "";
  return truncateToWidth(text, width, "…", true);
}
function pad(text: string, width: number): string {
  const fitted = fit(text, width);
  const gap = Math.max(0, width - plainWidth(fitted));
  return fitted + " ".repeat(gap);
}
function wrapFit(text: string, width: number): string[] {
  if (!text) return [""];
  return wrapTextWithAnsi(text, Math.max(1, width)).map((line) => fit(line, width));
}
function normalize(value: string): string { return value.toLowerCase().trim(); }

export class InteractiveBrowser<T> {
  focused = false;
  private cursor = 0;
  private page = 0;
  private query = "";
  private searchMode = false;
  private expanded = new Set<string>();
  private sortKey?: string;
  private sortAsc = true;
  private cachedWidth?: number;
  private cachedState?: string;
  private cachedLines?: string[];
  private filteredCacheKey?: string;
  private filteredCache?: BrowserItem<T>[];

  constructor(private opts: BrowserOptions<T>, private theme: BrowserTheme = defaultBrowserTheme()) {
    this.sortKey = opts.sortBy;
  }

  getFilteredItems(): BrowserItem<T>[] {
    const cacheKey = JSON.stringify({ q: this.query, sortKey: this.sortKey, sortAsc: this.sortAsc, total: this.opts.items.length });
    if (this.filteredCache && this.filteredCacheKey === cacheKey) return this.filteredCache;
    const q = normalize(this.query);
    let items = q ? this.opts.items.filter((entry) => normalize(`${entry.id} ${entry.searchText}`).includes(q)) : [...this.opts.items];
    if (this.sortKey) {
      const col = this.opts.columns.find((column) => column.key === this.sortKey);
      if (col?.sortValue) {
        items = [...items].sort((a, b) => {
          const av = col.sortValue?.(a.item) ?? "";
          const bv = col.sortValue?.(b.item) ?? "";
          const result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
          return this.sortAsc ? result : -result;
        });
      }
    }
    this.filteredCacheKey = cacheKey;
    this.filteredCache = items;
    return items;
  }

  getState() { return { cursor: this.cursor, page: this.page, query: this.query, searchMode: this.searchMode, expanded: [...this.expanded], total: this.opts.items.length, filtered: this.getFilteredItems().length }; }

  private pageSize(): number { return Math.max(1, this.opts.pageSize ?? 20); }
  private maxPage(filteredCount: number): number { return Math.max(0, Math.ceil(filteredCount / this.pageSize()) - 1); }
  private clamp(filteredCount = this.getFilteredItems().length): void {
    this.page = Math.min(Math.max(0, this.page), this.maxPage(filteredCount));
    const start = this.page * this.pageSize();
    const end = Math.max(start, Math.min(filteredCount, start + this.pageSize()) - 1);
    this.cursor = filteredCount === 0 ? 0 : Math.min(Math.max(start, this.cursor), end);
  }
  private invalidateState(): void { this.cachedWidth = undefined; this.cachedState = undefined; this.cachedLines = undefined; }
  invalidate(): void { this.invalidateState(); this.filteredCacheKey = undefined; this.filteredCache = undefined; }

  private move(delta: number): void {
    const count = this.getFilteredItems().length;
    if (count === 0) { this.cursor = 0; this.page = 0; return; }
    this.cursor = Math.min(count - 1, Math.max(0, this.cursor + delta));
    this.page = Math.floor(this.cursor / this.pageSize());
  }
  private setPage(page: number): void {
    const count = this.getFilteredItems().length;
    this.page = Math.min(Math.max(0, page), this.maxPage(count));
    this.cursor = Math.min(count - 1, this.page * this.pageSize());
    this.clamp(count);
  }
  private selectedEntry(): BrowserItem<T> | undefined { return this.getFilteredItems()[this.cursor]; }

  handleInput(data: string): void {
    if (this.searchMode) {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === "enter") this.searchMode = false;
      else if (matchesKey(data, Key.backspace) || data === "backspace") this.query = this.query.slice(0, -1);
      else if (matchesKey(data, Key.ctrl("u"))) this.query = "";
      else if (data.length === 1 && data >= " ") this.query += data;
      this.page = 0;
      this.cursor = 0;
      this.clamp();
      this.invalidateState();
      return;
    }

    if (matchesKey(data, Key.up) || data === "up") this.move(-1);
    else if (matchesKey(data, Key.down) || data === "down") this.move(1);
    else if (matchesKey(data, Key.home) || data === "home") { this.cursor = 0; this.page = 0; }
    else if (matchesKey(data, Key.end) || data === "end") { const n = this.getFilteredItems().length; this.cursor = Math.max(0, n - 1); this.page = this.maxPage(n); }
    else if (matchesKey(data, Key.pageUp) || data === "pageup" || data === "p") this.setPage(this.page - 1);
    else if (matchesKey(data, Key.pageDown) || data === "pagedown" || data === "n") this.setPage(this.page + 1);
    else if (data === "/") this.searchMode = true;
    else if (matchesKey(data, Key.enter) || matchesKey(data, Key.space) || data === "enter" || data === "space") {
      const selected = this.selectedEntry();
      if (selected) this.expanded.has(selected.id) ? this.expanded.delete(selected.id) : this.expanded.add(selected.id);
    } else if (matchesKey(data, Key.tab)) {
      const sortable = this.opts.columns.filter((column) => column.sortValue);
      if (sortable.length) {
        const i = Math.max(0, sortable.findIndex((column) => column.key === this.sortKey));
        this.sortKey = sortable[(i + 1) % sortable.length]?.key;
        this.cursor = 0; this.page = 0;
      }
    } else if (data === "S") {
      this.sortAsc = !this.sortAsc; this.cursor = 0; this.page = 0;
    } else if (matchesKey(data, Key.escape) || data === "q") {
      this.opts.onClose?.(null);
    } else {
      const action = this.opts.actions?.find((candidate) => candidate.key.toLowerCase() === data.toLowerCase());
      if (action) {
        const selected = this.selectedEntry();
        action.run?.(selected?.item);
        this.opts.onClose?.({ action: action.action, id: selected?.id, item: selected?.item });
      }
    }
    this.clamp();
    this.invalidateState();
  }

  private statusGlyph(status?: BrowserItem<T>["status"]): string {
    if (status === "healthy") return this.theme.success("✓");
    if (status === "warning") return this.theme.warning("⚠");
    if (status === "error") return this.theme.danger("✗");
    return this.theme.accent("•");
  }

  private layoutColumns(width: number): Array<BrowserColumn<T> & { actualWidth: number }> {
    const markerWidth = 4;
    const available = Math.max(20, width - markerWidth - 2);
    const columns = [...this.opts.columns].sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10));
    const visible: Array<BrowserColumn<T> & { actualWidth: number }> = [];
    let used = 0;
    for (const column of columns) {
      const requested = column.width ?? column.minWidth ?? 12;
      const min = column.minWidth ?? Math.min(8, requested);
      if (used + min + visible.length > available && visible.length > 0) continue;
      const actualWidth = Math.max(min, Math.min(requested, available - used - visible.length));
      visible.push({ ...column, actualWidth });
      used += actualWidth;
    }
    if (visible.length) {
      const remaining = available - used - Math.max(0, visible.length - 1);
      visible[visible.length - 1]!.actualWidth += Math.max(0, remaining);
    }
    return visible;
  }

  render(width: number): string[] {
    const state = JSON.stringify({ ...this.getState(), sortKey: this.sortKey, sortAsc: this.sortAsc });
    if (this.cachedLines && this.cachedWidth === width && this.cachedState === state) return this.cachedLines;
    const framed = this.opts.separatorStyle !== "sectioned";
    const W = framed ? Math.max(1, width || 80) : Math.max(40, width || 80);
    const th = this.theme;
    const sep = th.border("─".repeat(W));
    const filtered = this.getFilteredItems();
    this.clamp(filtered.length);
    const pageSize = this.pageSize();
    const maxPage = this.maxPage(filtered.length);
    const start = filtered.length === 0 ? 0 : this.page * pageSize;
    const endExclusive = Math.min(filtered.length, start + pageSize);
    const pageItems = filtered.slice(start, endExclusive);
    const columns = this.layoutColumns(W);
    const lines: string[] = [];
    if (framed) lines.push(sep);
    const title = th.title(`  ${this.opts.title}`);
    const stats = th.dim(`Page ${this.page + 1} / ${maxPage + 1} · Showing ${filtered.length ? start + 1 : 0}–${endExclusive} of ${filtered.length}${filtered.length !== this.opts.items.length ? ` (filtered from ${this.opts.items.length})` : ""}  `);
    lines.push(title + " ".repeat(Math.max(1, W - plainWidth(title) - plainWidth(stats))) + stats);
    if (this.opts.subtitle) lines.push(fit(th.metadata(`  ${this.opts.subtitle}`), W));
    lines.push(fit(th.dim(`  ${this.searchMode ? "Search:" : "Search"} ${this.query || "<none>"}  ·  Sort: ${this.sortKey ?? "none"}${this.sortAsc ? "↑" : "↓"}`), W));
    if (framed) lines.push("");
    else lines.push(sep);
    if (!pageItems.length) {
      lines.push(th.dim(`  ${this.opts.emptyMessage ?? "No results."}`));
    } else {
      const header = `    ${columns.map((column) => pad(column.label, column.actualWidth)).join(" ")}`;
      lines.push(th.dim(fit(header, W)));
      if (!framed) lines.push(sep);
      for (let offset = 0; offset < pageItems.length; offset++) {
        const absolute = start + offset;
        const entry = pageItems[offset]!;
        const selected = absolute === this.cursor;
        const expanded = this.expanded.has(entry.id);
        const marker = `${selected ? "▶" : " "} ${this.statusGlyph(entry.status)} `;
        const body = columns.map((column) => pad(column.render(entry.item), column.actualWidth)).join(" ");
        const line = fit(marker + body, W);
        lines.push(selected ? th.cursor(line) : th.content(line));
        if (expanded) {
          const details = entry.details ?? this.opts.detailLines?.(entry.item) ?? [];
          const detailTitle = this.opts.detailTitle?.(entry.item) ?? entry.id;
          lines.push(fit(th.accent(`    ${detailTitle}`), W));
          for (const detail of details) for (const wrapped of wrapFit(detail, W - 6)) lines.push(fit(th.dim(`      ${wrapped}`), W));
        }
      }
    }
    if (framed) lines.push("");
    else lines.push(sep);
    const actions = this.opts.actions?.length ? ` · ${this.opts.actions.map((a) => `${a.key} ${a.label}`).join(" · ")}` : "";
    lines.push(fit(th.dim(`  ↑↓ move · PgUp/PgDn/n/p page · Home/End · / search · Enter/Space expand · Tab sort · S reverse · ? help · q quit${actions}`), W));
    if (this.searchMode) lines.push(fit(th.accent("  Type to filter live · Enter/Esc closes search · Ctrl+U clears"), W));
    if (framed) lines.push(sep);
    this.cachedWidth = width;
    this.cachedState = state;
    this.cachedLines = lines.map((line) => fit(line, W));
    return this.cachedLines;
  }
}

export function createInteractiveBrowser<T>(opts: BrowserOptions<T>, done: (result: BrowserResult<T> | null) => void, tui: { requestRender(): void }, theme: unknown) {
  const browser = new InteractiveBrowser({ ...opts, onClose: done }, themeFromPi(theme));
  return {
    get focused() { return browser.focused; },
    set focused(v: boolean | undefined) { browser.focused = Boolean(v); },
    render: (width: number) => browser.render(width),
    invalidate: () => browser.invalidate(),
    handleInput: (data: string) => { browser.handleInput(data); tui.requestRender(); },
  };
}
