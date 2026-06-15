import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureMemoryDirs } from "./paths";
import { generateProcedureCandidates, type ProcedureCandidate } from "./procedure-candidates";
import { redactSecrets } from "./secret-scanner";

export interface SkillDraftArtifact {
  id: string;
  procedure_candidate_id: string;
  suggested_path: string;
  export_status: "review_required";
  requires_human_review: true;
  content: string;
  source_memory_ids: string[];
  evidence_ids: string[];
  created_at: string;
}

export interface SkillDraftResult {
  status: "draft_created" | "failed";
  message: string;
  artifact?: SkillDraftArtifact;
  path?: string;
}

function renderDraft(candidate: ProcedureCandidate): string {
  const name = candidate.suggested_skill_name ?? candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const lines = [
    `# ${candidate.title}`,
    "",
    "## Purpose",
    candidate.when_to_use,
    "",
    "## Scope",
    "Draft generated from governed procedure memory. Human review is required before creating a real skill file.",
    "",
    "## When to use",
    candidate.when_to_use,
    "",
    "## When not to use",
    "- Do not use when source memory is contested, outdated, or outside the current project scope.",
    "- Do not use as a published skill until a human reviews and tests it.",
    "",
    "## Allowed tools",
    "- read",
    "- bash",
    "- edit",
    "- write",
    "- project-specific verification commands listed below",
    "",
    "## Required checks",
    ...(candidate.verification_steps.length ? candidate.verification_steps.map((step) => `- ${step}`) : ["- Re-read source memory and evidence before use."]),
    "",
    "## Failure modes and guards",
    ...candidate.pitfalls.map((pitfall) => `- ${pitfall}`),
    "- Stop if evidence is redacted, deleted, or contradicts current instructions.",
    "",
    "## Procedure",
    ...candidate.steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Self-check before completion",
    "- Confirm source memory still applies.",
    "- Run the listed verification checks.",
    "- Do not claim completion without fresh verification evidence.",
    "",
    "## Tests or verification",
    ...(candidate.verification_steps.length ? candidate.verification_steps.map((step) => `- ${step}`) : ["- Add verification steps during human review."]),
    "",
    "## Source memory and evidence",
    `- Source memories: ${candidate.source_memory_ids.join(", ") || "none"}`,
    `- Evidence IDs: ${candidate.evidence_ids.join(", ") || "none"}`,
    "",
    "## Review status",
    "export_status: review_required",
    "requires_human_review: true",
    `suggested_skill_name: ${name}`,
    "",
  ];
  return redactSecrets(lines.join("\n"));
}

function artifactsDir(root: string): string {
  const dir = join(ensureMemoryDirs(root).reports, "skill-drafts");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function draftSkillFromProcedureCandidate(root: string, procedureCandidateId: string, now = new Date().toISOString()): SkillDraftResult {
  const report = generateProcedureCandidates(root, { now, minSourceRecords: 1 });
  const candidate = report.candidates.find((item) => item.procedure_candidate_id === procedureCandidateId) ?? report.candidates[0];
  if (!candidate || (procedureCandidateId && candidate.procedure_candidate_id !== procedureCandidateId)) return { status: "failed", message: `Procedure candidate not found: ${redactSecrets(procedureCandidateId)}` };
  if (candidate.source_memory_ids.length === 0 || candidate.evidence_ids.length === 0) return { status: "failed", message: "Procedure candidate lacks required source memory or evidence IDs." };
  const suggestedName = candidate.suggested_skill_name ?? "procedure-draft";
  const artifact: SkillDraftArtifact = {
    id: `skilldraft_${now.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    procedure_candidate_id: candidate.procedure_candidate_id,
    suggested_path: `skills/${suggestedName}/SKILL.md`,
    export_status: "review_required",
    requires_human_review: true,
    content: renderDraft(candidate),
    source_memory_ids: candidate.source_memory_ids,
    evidence_ids: candidate.evidence_ids,
    created_at: now,
  };
  const path = join(artifactsDir(root), `${artifact.id}.json`);
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
  return { status: "draft_created", message: `Created review-only skill draft artifact ${path}; no SKILL.md file was written.`, artifact, path };
}
