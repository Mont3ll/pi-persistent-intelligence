import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listBackgroundAnalysisJobs } from "./background-analysis";
import { appendCandidate, listCandidates } from "./inbox";
import { upsertInquiryRecord } from "./inquiries";
import { ensureMemoryDirs } from "./paths";
import { redactSecrets, redactSecretsInObject } from "./secret-scanner";
import { scoreMemoryWorth } from "./memory-worth";
import type { CaptureCandidate } from "./types";

export type FailureAnalysisClassification = "correction_candidate" | "procedure_candidate" | "inquiry" | "no_op";

export interface FailureAnalysisItem {
  id: string;
  source: string;
  summary: string;
  classification: FailureAnalysisClassification;
  worth_decision: string;
  worth_reasons: string[];
  candidate_id?: string;
  inquiry_id?: string;
}

export interface FailureAnalysisReport {
  generated_at: string;
  items: FailureAnalysisItem[];
  durable_memory_mutated: false;
}

function reportsDir(root: string): string {
  const dir = join(ensureMemoryDirs(root).reports, "failure-analysis");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function candidateFromFailure(root: string, item: FailureAnalysisItem, now: string): CaptureCandidate {
  const candidate: CaptureCandidate = {
    id: `cap_failure_${item.id}`,
    created_at: now,
    source: { type: "failure_analysis", ref: item.source },
    text: item.summary,
    tags: ["failure-analysis", item.classification === "procedure_candidate" ? "workflow" : "correction"],
    evidence_refs: [item.source],
    confidence: item.classification === "procedure_candidate" ? 0.7 : 0.65,
    status: "new",
    worth_decision: item.worth_decision as any,
    worth_reasons: [...item.worth_reasons, "review_required:failure_analysis"],
    primary_trust_class: "agent_inference",
    durability_signal: "task",
    promotion_eligibility: "review_only",
    poisoning_risk: "medium",
  };
  appendCandidate(root, candidate);
  return candidate;
}

export function runFailureAnalysis(root: string, options: { now?: string; save?: boolean } = {}): { report: FailureAnalysisReport; path?: string } {
  const now = options.now ?? new Date().toISOString();
  const items: FailureAnalysisItem[] = [];
  for (const job of listBackgroundAnalysisJobs(root).filter((job) => job.status === "failed")) {
    const summary = redactSecrets(`Background job ${job.kind} failed: ${job.error ?? "unknown error"}`);
    const worth = scoreMemoryWorth({ observation: summary, evidenceStrength: 0.4, durability: "task", operationalImpact: /diagnostics|reverification|background/.test(summary) ? 0.7 : 0.3 });
    const item: FailureAnalysisItem = { id: job.id, source: `background_job:${job.id}`, summary, classification: "inquiry", worth_decision: worth.decision, worth_reasons: [...worth.reasons, "background_failure_requires_review"] };
    if (item.classification === "inquiry") {
      const inquiry = upsertInquiryRecord(root, { question: summary, profile_id: job.profile_id, session_id: job.thread_id, now });
      item.inquiry_id = inquiry.id;
    }
    items.push(item);
  }

  for (const cand of listCandidates(root).filter((candidate) => candidate.status === "rejected")) {
    const summary = redactSecrets(`Rejected candidate may indicate a correction or conflict to review: ${cand.text}`);
    const worth = scoreMemoryWorth({ observation: summary, evidenceStrength: 0.3, durability: "task" });
    const classification: FailureAnalysisClassification = worth.decision === "reject" ? "no_op" : /always|never|prefer|don't|do not/i.test(cand.text) ? "correction_candidate" : "inquiry";
    const item: FailureAnalysisItem = { id: cand.id, source: `candidate:${cand.id}`, summary, classification, worth_decision: worth.decision, worth_reasons: worth.reasons };
    if (classification === "correction_candidate") item.candidate_id = candidateFromFailure(root, item, now).id;
    if (classification === "inquiry") item.inquiry_id = upsertInquiryRecord(root, { question: summary, profile_id: cand.profile_id, session_id: cand.thread_id, now }).id;
    items.push(item);
  }

  const report: FailureAnalysisReport = redactSecretsInObject({ generated_at: now, items, durable_memory_mutated: false }) as FailureAnalysisReport;
  if (!options.save) return { report };
  const path = join(reportsDir(root), `${now.replace(/[:.]/g, "-").slice(0, 19)}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return { report, path };
}

export function renderFailureAnalysisReport(report: FailureAnalysisReport): string {
  const lines = ["# Failure Analysis", "", `Generated: ${report.generated_at}`, "", "> Review-only. Durable memory was not mutated.", ""];
  for (const item of report.items) lines.push(`- ${item.id}: ${item.classification} / ${item.worth_decision} — ${item.summary}`);
  if (report.items.length === 0) lines.push("No actionable failures found.");
  return redactSecrets(lines.join("\n"));
}
