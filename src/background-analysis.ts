import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runMemoryDiagnostics, renderDiagnosticsReport, saveDiagnosticsReport } from "./diagnostics";
import { ensureMemoryDirs } from "./paths";
import { redactSecrets, redactSecretsInObject } from "./secret-scanner";
import { checkProvenanceLiveness } from "./provenance-liveness";
import { generateReverificationRecommendations } from "./reverification";
import { exportMemoryGraph, renderMemoryGraphSummary, saveMemoryGraphReport } from "./memory-graph";
import { buildMemoryTimeline, renderMemoryTimeline, saveMemoryTimelineReport } from "./timeline";
import { generateProcedureCandidates, renderProcedureCandidateReport, saveProcedureCandidateReport } from "./procedure-candidates";
import { listCandidates } from "./inbox";
import { scoreMemoryWorth } from "./memory-worth";
import { runMetaConsolidation, DEFAULT_META_CONSOLIDATION_CONFIG } from "./meta-consolidation";
import { appendRuntimeEvent } from "./runtime-events";

export type BackgroundAnalysisKind =
  | "diagnostics"
  | "provenance_liveness"
  | "reverification"
  | "memory_graph"
  | "memory_timeline"
  | "procedure_candidates"
  | "meta_consolidation"
  | "vault_promotion_candidates"
  | "memory_worth_review";

export interface BackgroundAnalysisJob {
  id: string;
  kind: BackgroundAnalysisKind;
  profile_id?: string;
  resource_id?: string;
  thread_id?: string;
  created_at: string;
  started_at?: string;
  status: "queued" | "running" | "succeeded" | "failed";
  input_summary?: string;
  output_artifact_path?: string;
  error?: string;
  warnings?: string[];
}

export interface EnqueueBackgroundAnalysisInput {
  kind: BackgroundAnalysisKind;
  profile_id?: string;
  resource_id?: string;
  thread_id?: string;
  input_summary?: string;
}

function queueDir(root: string): string {
  const dir = join(ensureMemoryDirs(root).runtime.dir, "background-analysis");
  mkdirSync(dir, { recursive: true });
  return dir;
}
const LOCK_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_SLOW_JOB_MS = 30_000;
const SLOW_JOB_MS_BY_KIND: Partial<Record<BackgroundAnalysisKind, number>> = {
  meta_consolidation: 90_000,
  vault_promotion_candidates: 60_000,
};

function queuePath(root: string): string { return join(queueDir(root), "jobs.json"); }
function lockPath(root: string): string { return join(queueDir(root), "jobs.lock"); }
function isOlderThan(value: string | undefined, nowMs: number, ageMs: number): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && nowMs - time > ageMs;
}
function readJobs(root: string): BackgroundAnalysisJob[] {
  const file = queuePath(root);
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, "utf-8")) as BackgroundAnalysisJob[]; } catch { return []; }
}
function writeJobs(root: string, jobs: BackgroundAnalysisJob[]): void { writeFileSync(queuePath(root), `${JSON.stringify(jobs, null, 2)}\n`, "utf-8"); }
function recoverStaleRunningJobs(root: string, jobs: BackgroundAnalysisJob[], now: string): BackgroundAnalysisJob[] {
  const nowMs = new Date(now).getTime();
  return jobs.map((job) => {
    if (job.status !== "running" || !isOlderThan((job as any).started_at ?? job.created_at, nowMs, LOCK_MAX_AGE_MS)) return job;
    appendRuntimeEvent(root, { type: "warn", severity: "medium", component: "background", message: `job ${job.id} recovered from stale running state` });
    return { ...job, status: "failed", error: "stale_running: process recovered", warnings: [...(job.warnings ?? []), "stale_running: process recovered"] };
  });
}

function tryAcquireQueueLock(root: string, now: string): boolean {
  const lock = lockPath(root);
  try {
    const fd = openSync(lock, "wx");
    try { writeFileSync(fd, `${JSON.stringify({ created_at: now })}\n`, "utf-8"); }
    finally { closeSync(fd); }
    return true;
  } catch (err) {
    if ((err as { code?: string }).code !== "EEXIST") throw err;
    let lockedAt = "";
    try { lockedAt = JSON.parse(readFileSync(lock, "utf-8")).created_at; } catch { lockedAt = ""; }
    if (!isOlderThan(lockedAt, new Date(now).getTime(), LOCK_MAX_AGE_MS)) return false;
    try { rmSync(lock, { force: true }); } catch { /* ignore stale lock cleanup */ }
    const fd = openSync(lock, "wx");
    try { writeFileSync(fd, `${JSON.stringify({ created_at: now })}\n`, "utf-8"); }
    finally { closeSync(fd); }
    return true;
  }
}
function makeId(kind: BackgroundAnalysisKind, now: string): string { return `bg_${kind}_${now.replace(/[-:.TZ]/g, "").slice(0, 14)}`; }

export function enqueueBackgroundAnalysis(root: string, input: EnqueueBackgroundAnalysisInput, now = new Date().toISOString()): BackgroundAnalysisJob {
  const jobs = readJobs(root);
  let id = makeId(input.kind, now);
  if (jobs.some((j) => j.id === id)) id = `${id}_${jobs.length + 1}`;
  const job: BackgroundAnalysisJob = { ...input, id, created_at: now, status: "queued" };
  jobs.push(job);
  writeJobs(root, jobs);
  return job;
}

export function listBackgroundAnalysisJobs(root: string): BackgroundAnalysisJob[] { return readJobs(root); }

export interface RunBackgroundAnalysisOptions {
  now?: string;
  supportedKinds?: BackgroundAnalysisKind[];
  slowJobThresholdMs?: number;
}

function backgroundReportPath(root: string, kind: BackgroundAnalysisKind, createdAt: string, ext: "json" | "md"): string {
  const dir = join(ensureMemoryDirs(root).reports, "background-analysis", kind);
  mkdirSync(dir, { recursive: true });
  const stamp = createdAt.replace(/[:.]/g, "-").slice(0, 19);
  return join(dir, `${stamp}.${ext}`);
}

function writeJsonReport(root: string, job: BackgroundAnalysisJob, payload: unknown): string {
  const path = backgroundReportPath(root, job.kind, job.created_at, "json");
  writeFileSync(path, `${JSON.stringify(redactSecretsInObject(payload), null, 2)}\n`, "utf-8");
  return path;
}

function writeMarkdownReport(root: string, job: BackgroundAnalysisJob, markdown: string): string {
  const path = backgroundReportPath(root, job.kind, job.created_at, "md");
  writeFileSync(path, redactSecrets(markdown), "utf-8");
  return path;
}

function runOne(root: string, job: BackgroundAnalysisJob, supportedKinds?: BackgroundAnalysisKind[]): BackgroundAnalysisJob {
  if (supportedKinds && !supportedKinds.includes(job.kind)) throw new Error(`Unsupported background analysis kind: ${job.kind}`);
  if (job.kind === "diagnostics") {
    const report = runMemoryDiagnostics(root);
    const jsonPath = saveDiagnosticsReport(root, report);
    const mdPath = jsonPath.replace(/\.json$/, ".md");
    writeFileSync(mdPath, renderDiagnosticsReport(report), "utf-8");
    return { ...job, status: "succeeded", output_artifact_path: mdPath, warnings: report.summary.warnings > 0 ? [`${report.summary.warnings} diagnostic warning(s)`] : [] };
  }
  if (job.kind === "provenance_liveness") {
    const report = checkProvenanceLiveness(root, job.created_at);
    const path = writeJsonReport(root, job, report);
    return { ...job, status: "succeeded", output_artifact_path: path, warnings: report.findings.length ? [`${report.findings.length} provenance finding(s)`] : [] };
  }
  if (job.kind === "reverification") {
    const recommendations = generateReverificationRecommendations(root);
    const path = writeJsonReport(root, job, { generated_at: job.created_at, recommendations });
    return { ...job, status: "succeeded", output_artifact_path: path, warnings: recommendations.length ? [`${recommendations.length} re-verification recommendation(s)`] : [] };
  }
  if (job.kind === "memory_graph") {
    const graph = exportMemoryGraph(root, job.created_at);
    const path = saveMemoryGraphReport(root, graph);
    return { ...job, status: "succeeded", output_artifact_path: path };
  }
  if (job.kind === "memory_timeline") {
    const timeline = buildMemoryTimeline(root, {}, job.created_at);
    const path = saveMemoryTimelineReport(root, timeline);
    return { ...job, status: "succeeded", output_artifact_path: path };
  }
  if (job.kind === "procedure_candidates") {
    const report = generateProcedureCandidates(root, { now: job.created_at, minSourceRecords: 2 });
    const paths = saveProcedureCandidateReport(root, report);
    return { ...job, status: "succeeded", output_artifact_path: paths.mdPath };
  }
  if (job.kind === "meta_consolidation") {
    const run = runMetaConsolidation(root, { ...DEFAULT_META_CONSOLIDATION_CONFIG, enabled: true, min_l2_records: 2, require_counterexample_search: true }, job.profile_id ?? "default", job.created_at);
    return { ...job, status: "succeeded", output_artifact_path: run.report_path, warnings: ["Review-only: no L1 memory was mutated."] };
  }
  if (job.kind === "vault_promotion_candidates") {
    const candidates = listCandidates(root).filter((candidate) => candidate.status === "new");
    const path = writeJsonReport(root, job, { generated_at: job.created_at, review_required: true, vault_mutated: false, candidates: candidates.map((candidate) => ({ candidate_id: candidate.id, statement: candidate.text, evidence_ids: candidate.evidence_ids ?? [], review_required: true })) });
    return { ...job, status: "succeeded", output_artifact_path: path, warnings: ["Review-only: no vault files were mutated."] };
  }
  if (job.kind === "memory_worth_review") {
    const candidates = listCandidates(root).filter((candidate) => candidate.status === "new");
    const scored = candidates.map((candidate) => ({ candidate_id: candidate.id, text: candidate.text, ...scoreMemoryWorth({ observation: candidate.text, existingStatements: candidates.filter((c) => c.id !== candidate.id).map((c) => c.text) }) }));
    const path = writeMarkdownReport(root, job, [`# Memory-worth Review`, ``, `Generated: ${job.created_at}`, ``, ...scored.map((item) => `- ${item.candidate_id}: ${item.decision} (${item.worth_score}) ${item.reasons.join(", ")}`)].join("\n"));
    return { ...job, status: "succeeded", output_artifact_path: path, warnings: scored.some((item) => item.decision === "reject") ? ["One or more candidates scored as reject"] : [] };
  }
  throw new Error(`Unsupported background analysis kind: ${job.kind}`);
}

export function runBackgroundAnalysisQueue(root: string, options: RunBackgroundAnalysisOptions = {}): BackgroundAnalysisJob[] {
  const now = options.now ?? new Date().toISOString();
  const lock = lockPath(root);
  if (!tryAcquireQueueLock(root, now)) {
    appendRuntimeEvent(root, { type: "info", severity: "low", component: "background", message: "background queue run skipped because another runner is active", timestamp: now });
    return readJobs(root);
  }

  try {
    const jobs = recoverStaleRunningJobs(root, readJobs(root), now);
    const updated: BackgroundAnalysisJob[] = [];
    for (const job of jobs) {
      if (job.status !== "queued") { updated.push(job); continue; }
      let running: BackgroundAnalysisJob = { ...job, status: "running", started_at: now };
      updated.push(running);
      writeJobs(root, [...updated, ...jobs.slice(updated.length)]);
      try {
        const started = performance.now();
        running = runOne(root, running, options.supportedKinds);
        const elapsed = performance.now() - started;
        const threshold = options.slowJobThresholdMs ?? SLOW_JOB_MS_BY_KIND[job.kind] ?? DEFAULT_SLOW_JOB_MS;
        if (elapsed > threshold) {
          const warning = `slow_job: ${Math.round(elapsed)}ms exceeded ${threshold}ms`;
          running = { ...running, warnings: [...(running.warnings ?? []), warning] };
          appendRuntimeEvent(root, { type: "warn", severity: "medium", component: "background", message: `job ${job.id} was slow: ${Math.round(elapsed)}ms`, timestamp: now });
        }
        updated[updated.length - 1] = running;
      } catch (err) {
        const failed = { ...running, status: "failed" as const, error: redactSecrets(err instanceof Error ? err.message : String(err)) };
        appendRuntimeEvent(root, { type: "error", severity: "medium", component: "background", message: `job ${job.id} failed: ${failed.error}`, timestamp: now });
        updated[updated.length - 1] = failed;
      }
    }
    writeJobs(root, updated);
    return updated;
  } finally {
    try { rmSync(lock, { force: true }); } catch { /* ignore */ }
  }
}
