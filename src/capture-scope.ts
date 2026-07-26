import type { CaptureIntentDecision } from "./capture-intent";
import type { CaptureScopeTarget, ProjectIdentity, SessionActivity } from "./types";

export interface ResolveCaptureScopeInput {
  text: string;
  decision: CaptureIntentDecision;
  launch_project: ProjectIdentity;
  activity: SessionActivity[];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function isVaultApplicable(text: string): boolean {
  return /\b(?:this |the )?(?:obsidian )?vault\b/i.test(text)
    || /\b(?:citation|provenance|source bod(?:y|ies)|ingest(?:ion)?|zettelkasten|wiki schema)\b/i.test(text);
}

export function resolveCaptureScopes(input: ResolveCaptureScopeInput): CaptureScopeTarget[] {
  if (input.decision.intent === "temporary_instruction" || input.decision.intent === "not_memory") {
    return [{ type: "session", confidence: 0.98, basis: ["non_durable_intent"] }];
  }

  const strongGlobalCue = input.decision.global_cues.some((cue) => !["\\bmy preference\\b", "\\bi prefer\\b", "\\bi do not like\\b"].includes(cue));
  if (strongGlobalCue) {
    return [{ type: "global", confidence: 0.95, basis: ["explicit_user_global"] }];
  }

  if (isVaultApplicable(input.text)) {
    const vaultProject = input.launch_project.project_id.includes("vault")
      ? input.launch_project.project_id
      : input.activity.flatMap((row) => row.modified_projects).find((item) => item.project_id.includes("vault"))?.project_id;
    if (vaultProject) return [{ type: "project", project: vaultProject, confidence: 0.95, basis: ["explicit_vault_scope"] }];
  }

  const explicitProjects = unique(input.activity.flatMap((row) => row.explicit_project_mentions));
  if (explicitProjects.length > 0) {
    return explicitProjects.map((project) => ({ type: "project", project, confidence: 0.95, basis: ["explicit_project_scope"] }));
  }

  const modifiedProjects = unique(input.activity.flatMap((row) => row.modified_projects.map((item) => item.project_id)));
  if (modifiedProjects.length > 0) {
    return modifiedProjects.map((project) => ({ type: "project", project, confidence: 0.9, basis: ["modified_project"] }));
  }

  if (input.decision.project_cues.length > 0 || input.decision.durability === "project") {
    return [{ type: "project", project: input.launch_project.project_id, confidence: 0.6, basis: ["launch_project_fallback"] }];
  }

  return [{ type: "global", confidence: 0.7, basis: ["long_term_user_instruction"] }];
}
