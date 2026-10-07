import type { CaptureIntent } from "./types";

export interface CaptureIntentDecision {
  intent: CaptureIntent;
  confidence: number;
  durability: "temporary" | "task" | "project" | "long_term";
  global_cues: string[];
  project_cues: string[];
  applicability: string[];
  reasons: string[];
}

function normalize(text: string): string {
  return text
    .replace(/em[ -]?dashes?/gi, "em dash")
    .replace(/en[ -]?dashes?/gi, "en dash")
    .replace(/\s+/g, " ")
    .trim();
}

function applicability(text: string): string[] {
  const lower = text.toLowerCase();
  const values: string[] = [];
  if (/\b(writ|documentation|document|article|blog|linkedin|portfolio|application|profile|punctuation|heading|quotation|em dash|en dash|humanizer|promotional language)\b/.test(lower)) values.push("writing");
  if (/\b(documentation|document|readme|changelog|wiki)\b/.test(lower)) values.push("documentation");
  if (/\b(publish|release|package|tag|registry)\b/.test(lower)) values.push("release");
  if (/\b(test|typecheck|lint|clippy|rustfmt|cargo check)\b/.test(lower)) values.push("testing");
  if (/\b(implement|code|edit|repository|repo|codebase)\b/.test(lower)) values.push("implementation");
  return [...new Set(values)];
}

function decision(
  intent: CaptureIntent,
  confidence: number,
  durability: CaptureIntentDecision["durability"],
  text: string,
  reasons: string[],
): CaptureIntentDecision {
  const lower = text.toLowerCase();
  const globalCues = [
    /\bmy preference\b/,
    /\bi prefer\b/,
    /\bi do not like\b/,
    /\bfor (?:all )?my writing\b/,
    /\bwhen writing for me\b/,
    /\bacross projects\b/,
    /\bpublic (?:writing|documentation)\b/,
  ].filter((pattern) => pattern.test(lower)).map((pattern) => pattern.source);
  const projectCues = [
    /\bthis (?:project|repository|repo|codebase)\b/,
    /\bin this (?:project|repository|repo|codebase)\b/,
  ].filter((pattern) => pattern.test(lower)).map((pattern) => pattern.source);
  return { intent, confidence, durability, global_cues: globalCues, project_cues: projectCues, applicability: applicability(text), reasons };
}

function hasDurableIntentCue(text: string): boolean {
  return /\b(going forward|from now on|across projects|my preference|i prefer|for (?:all )?my writing|when writing for me)\b/i.test(text)
    || /\bthis (?:project|repository|repo|codebase)\b[^.]{0,80}\b(always|requires|uses|never)\b/i.test(text);
}

function hasTopLevelDurableIntentCue(text: string): boolean {
  const firstTaskConstraint = text.search(/\b(?:do not|don't)\b/i);
  if (firstTaskConstraint < 0) return hasDurableIntentCue(text);
  return hasDurableIntentCue(text.slice(0, firstTaskConstraint));
}

function hasVerifierTaskWrapper(text: string): boolean {
  const prefix = text.match(/^(resume|verify|complete)\b/i)?.[1]?.toLowerCase();
  if (!prefix) return false;

  const taskConstraints = text.match(/\b(?:do not|don't)\b/gi)?.length ?? 0;

  if (prefix === "complete") {
    const releaseCompletionContext = /\b(?:verification|release|publish|publication|tag|registry|live (?:pi )?store|checkout)\b/i.test(text);
    const stopConstraint = /\b(?:do not|don't|stop immediately|stop after)\b/i.test(text);
    return releaseCompletionContext && stopConstraint;
  }

  const operationalContext = /\b(?:verification|worktree|head|sha|branch|source|live (?:pi )?store|checkout|pull request|\bpr\b|typecheck|test|eval|stress)\b/i.test(text);
  return operationalContext && taskConstraints >= 2;
}

function hasTaskBoundOperationalCue(text: string): boolean {
  return hasVerifierTaskWrapper(text)
    || /\bduring this task\b/i.test(text)
    || /\bthis (?:slice|stage|run|audit|exercise)\b[^.]{0,80}\b(?:only|limited|bounded)\b/i.test(text)
    || /\bthis is (?:implementation|verification|implementation and verification) work only\b/i.test(text)
    || /\b(?:red|green) stage\b[^.]{0,120}\b(?:issue|fix|verification)\b/i.test(text)
    || /\bdo not rerun\b[^.]{0,160}\b(?:audit|verification|test|check)\b/i.test(text)
    || /\buse only\b[^.]{0,160}\b(?:already-created|existing|provided)?\s*(?:audit )?(?:artifacts|logs|files|results)\b/i.test(text);
}

export function isSyntheticCaptureContext(rawText: string): boolean {
  return /^\s*<skill(?:\s|>)/i.test(rawText);
}

export function classifyCaptureIntent(rawText: string): CaptureIntentDecision {
  const text = normalize(rawText);
  const lower = text.toLowerCase();
  if (!text || text.length < 8) return decision("not_memory", 0, "temporary", text, ["too_short"]);

  if (isSyntheticCaptureContext(rawText)) {
    return decision("not_memory", 0.99, "temporary", text, ["synthetic_harness_context"]);
  }
  if (/^(?:task:|your goal is|you are a delegated|you are a subagent|<file name=|# instructions)/i.test(text)) {
    return decision("not_memory", 0.98, "temporary", text, ["task_or_agent_wrapper"]);
  }
  if (/\b(?:the article|the documentation|repository documentation|the source|the paper)\s+(?:says|states|recommends|discusses)\b/i.test(text)) {
    return decision("not_memory", 0.95, "temporary", text, ["quoted_or_third_party_guidance"]);
  }
  if (/^this (?:paragraph|article|document) discusses\b/i.test(text)) {
    return decision("not_memory", 0.95, "temporary", text, ["descriptive_not_preference"]);
  }
  if (/\b(for this (?:response|task|session)|right now|for now|temporarily|only this time)\b/i.test(text)) {
    return decision("temporary_instruction", 0.95, "task", text, ["explicit_temporary_scope"]);
  }
  if (hasVerifierTaskWrapper(text) && !hasTopLevelDurableIntentCue(text)) {
    return decision("temporary_instruction", 0.95, "task", text, ["task_bound_operational_scope"]);
  }
  if (!hasDurableIntentCue(text) && hasTaskBoundOperationalCue(text)) {
    return decision("temporary_instruction", 0.95, "task", text, ["task_bound_operational_scope"]);
  }

  const durableResumeCorrection = hasDurableIntentCue(text) && /\bresume\s+using\b/i.test(text);
  if (durableResumeCorrection) return decision("behavior_correction", 0.9, "project", text, ["explicit_behavior_correction"]);

  const declarativeProjectConvention = /\bthis (?:project|repository|repo|codebase)\s+(?:always\s+)?(?:uses|requires|runs|keeps|stores)\b/i.test(text);
  const imperativeProjectConvention = /\bfor this (?:project|repository|repo|codebase)\s*,?\s*always\s+(?:use|keep|store|run|require)\b/i.test(text)
    || (/\bfor this (?:project|repository|repo|codebase)\s*,?\s*(?:use|keep|store|run|require)\b/i.test(text)
      && /\b(?:going forward|from now on)\b/i.test(text));
  if (declarativeProjectConvention || imperativeProjectConvention) {
    return decision("project_convention", 0.92, "project", text, ["explicit_project_convention"]);
  }

  const workflow = /\b(before|after|when)\s+(?:publishing|releasing|committing|pushing|deploying|testing)\b[^.]*\b(run|use|check|verify|write|update|build)\b/i.test(text)
    || /\b(?:always|never)\s+(?:run|check|verify|build|test)\b/i.test(text);
  if (workflow) return decision("workflow_playbook", 0.88, "project", text, ["reusable_workflow"]);

  const directPreference = /\b(?:i prefer|my preference is|i do not like|i don't like|when writing for me|for (?:all )?my writing)\b/i.test(text)
    || /\bavoid(?:ing)?\s+[a-z0-9]/i.test(text);
  if (directPreference) return decision("user_preference", 0.9, "long_term", text, ["explicit_user_preference"]);

  const correction = /\b(?:do not|don't|never|stop using|use .+ instead|prefer .+ (?:over|to|instead of)|that's wrong|this is wrong)\b/i.test(text);
  if (correction) return decision("behavior_correction", 0.9, "project", text, ["explicit_behavior_correction"]);

  return decision("not_memory", 0.4, "temporary", text, ["no_durable_intent"]);
}
