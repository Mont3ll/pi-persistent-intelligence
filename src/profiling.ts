export interface ProfileSpan {
  name: string;
  start_ms: number;
  duration_ms: number;
  metrics?: Record<string, number | string | boolean>;
}

export interface InvocationProfileReport {
  name: string;
  started_at_ms: number;
  total_ms: number;
  spans: ProfileSpan[];
}

type NowFn = () => number;
type MetricValue = number | string | boolean;

function sanitizeMetrics(metrics: Record<string, unknown> | undefined): Record<string, MetricValue> | undefined {
  if (!metrics) return undefined;
  const clean: Record<string, MetricValue> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number" || typeof value === "boolean") clean[key] = value;
    else if (typeof value === "string" && value.length <= 120 && !/payload|secret|private|token|key/i.test(key)) clean[key] = value;
  }
  return Object.keys(clean).length ? clean : undefined;
}

export function renderInvocationProfileReport(report: InvocationProfileReport): string {
  const lines = [`Profile: ${report.name}`, `Total: ${Math.round(report.total_ms)}ms`];
  for (const span of report.spans) {
    const metrics = span.metrics ? ` (${Object.entries(span.metrics).map(([key, value]) => `${key}=${value}`).join(", ")})` : "";
    lines.push(`- ${span.name}: ${Math.round(span.duration_ms)}ms${metrics}`);
  }
  return lines.join("\n");
}

export class InvocationProfiler {
  private readonly startedAt: number;
  private readonly spans: ProfileSpan[] = [];

  constructor(private readonly name: string, private readonly now: NowFn = () => performance.now()) {
    this.startedAt = this.now();
  }

  startSpan(name: string): (metrics?: Record<string, unknown>) => void {
    const start = this.now();
    let ended = false;
    return (metrics?: Record<string, unknown>) => {
      if (ended) return;
      ended = true;
      this.spans.push({ name, start_ms: Math.max(0, start - this.startedAt), duration_ms: Math.max(0, this.now() - start), metrics: sanitizeMetrics(metrics) });
    };
  }

  measure<T>(name: string, fn: () => T, metrics?: Record<string, unknown>): T {
    const end = this.startSpan(name);
    try { return fn(); }
    finally { end(metrics); }
  }

  async measureAsync<T>(name: string, fn: () => Promise<T>, metrics?: Record<string, unknown>): Promise<T> {
    const end = this.startSpan(name);
    try { return await fn(); }
    finally { end(metrics); }
  }

  toReport(): InvocationProfileReport {
    return { name: this.name, started_at_ms: this.startedAt, total_ms: Math.max(0, this.now() - this.startedAt), spans: [...this.spans] };
  }
}
