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

export function classifyCaptureIntent(rawText: string): CaptureIntentDecision {
  const text = normalize(rawText);
  const lower = text.toLowerCase();
  if (!text || text.length < 8) return decision("not_memory", 0, "temporary", text, ["too_short"]);

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

  const projectConvention = /\bthis (?:project|repository|repo|codebase)\s+(?:always\s+)?(?:uses|requires|runs|keeps|stores)\b/i.test(text);
  if (projectConvention) return decision("project_convention", 0.92, "project", text, ["explicit_project_convention"]);

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
