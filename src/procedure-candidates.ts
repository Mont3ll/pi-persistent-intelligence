import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureMemoryDirs } from "./paths";
import { loadAllRecords } from "./store";
import { redactSecretsInObject } from "./secret-scanner";
import type { MemoryRecord } from "./types";

export interface ProcedureCandidate {
  title: string;
  when_to_use: string;
  steps: string[];
  pitfalls: string[];
  verification_steps: string[];
  source_memory_ids: string[];
  evidence_ids: string[];
  confidence: number;
  requires_review: true;
}

export interface ProcedureCandidateReport {
  generated_at: string;
  candidates: ProcedureCandidate[];
  skipped_reasons: Record<string, string>;
}

export interface ProcedureCandidateOptions {
  minSourceRecords?: number;
  now?: string;
}

function eligible(record: MemoryRecord): boolean {
  if (record.layer !== "L2" || record.status !== "active") return false;
  if (record.stability !== "stable" && record.stability !== "semi-stable") return false;
  const haystack = `${record.tags.join(" ")} ${record.ruleType ?? ""} ${record.statement}`.toLowerCase();
  return /workflow|testing|tool|tooling|run |verify|commit|push|test|typecheck/.test(haystack);
}

function titleFrom(records: MemoryRecord[]): string {
  if (records.some((r) => /test|typecheck|verify/i.test(r.statement))) return "Verification workflow candidate";
  return "Workflow procedure candidate";
}

export function generateProcedureCandidates(root: string, options: ProcedureCandidateOptions = {}): ProcedureCandidateReport {
  const min = options.minSourceRecords ?? 3;
  const records = loadAllRecords(root);
  const candidates = records.filter(eligible).sort((a, b) => a.id.localeCompare(b.id));
  const skipped_reasons: Record<string, string> = {};
  for (const record of records) {
    if (!eligible(record)) skipped_reasons[record.id] = record.status !== "active" ? `Excluded status: ${record.status}` : "Not a workflow/procedure source.";
  }
  if (candidates.length < min) return { generated_at: options.now ?? new Date().toISOString(), candidates: [], skipped_reasons };

  const selected = candidates.slice(0, 6);
  const procedure: ProcedureCandidate = {
    title: titleFrom(selected),
    when_to_use: "Use when repeated workflow memory records indicate a stable operating procedure.",
    steps: selected.map((record) => record.statement),
    pitfalls: ["Review before turning this into a skill.", "Do not treat this report as canonical memory."],
    verification_steps: selected.filter((record) => /test|typecheck|verify|check/i.test(record.statement)).map((record) => record.statement),
    source_memory_ids: selected.map((record) => record.id),
    evidence_ids: [...new Set(selected.flatMap((record) => record.evidence.map((ev) => ev.ref)))],
    confidence: Number((selected.reduce((sum, record) => sum + record.confidence, 0) / selected.length).toFixed(2)),
    requires_review: true,
  };

  return redactSecretsInObject({ generated_at: options.now ?? new Date().toISOString(), candidates: [procedure], skipped_reasons }) as ProcedureCandidateReport;
}

export function renderProcedureCandidateReport(report: ProcedureCandidateReport): string {
  const lines = [`# Procedure Candidate Report`, "", `Generated: ${report.generated_at}`, "", "> Review-only. No skill files were written and no memory was mutated.", ""];
  for (const candidate of report.candidates) {
    lines.push(`## ${candidate.title}`, "", `When to use: ${candidate.when_to_use}`, "", "Steps:");
    candidate.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    lines.push("", "Verification:");
    (candidate.verification_steps.length ? candidate.verification_steps : ["Review source memory records manually."]).forEach((step) => lines.push(`- ${step}`));
    lines.push("", `Sources: ${candidate.source_memory_ids.join(", ")}`, "");
  }
  if (report.candidates.length === 0) lines.push("No procedure candidates met the minimum source threshold.");
  return redactSecretsInObject(lines.join("\n")) as string;
}

export function saveProcedureCandidateReport(root: string, report: ProcedureCandidateReport): { jsonPath: string; mdPath: string } {
  const dir = join(ensureMemoryDirs(root).reports, "procedure-candidates");
  mkdirSync(dir, { recursive: true });
  const stamp = report.generated_at.replace(/[:.]/g, "-").slice(0, 19);
  const jsonPath = join(dir, `${stamp}.json`);
  const mdPath = join(dir, `${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(redactSecretsInObject(report), null, 2)}\n`, "utf-8");
  writeFileSync(mdPath, `${renderProcedureCandidateReport(report)}\n`, "utf-8");
  return { jsonPath, mdPath };
}
