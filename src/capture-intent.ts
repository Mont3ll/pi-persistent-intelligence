import type { CaptureIntent } from "./types";
import { hasExplicitTaskOnlyScope } from "./temporary-scope";

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
  const prefix = text.match(/^(resume|verify|reverify|complete)\b/i)?.[1]?.toLowerCase();
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


/**
 * An explicit request not to remember the current material outranks any
 * durable-sounding words inside that material. Scope this to deictic requests
 * ("this", "that", "the above"), not general rules such as "never store tokens".
 */
export function hasExplicitMemoryOptOut(rawText: string): boolean {
  const text = rawText.replace(/[\u2018\u2019]/g, "'");
  return /\b(?:do not|don't|please don't|never)\s+(?:remember|retain|store|save|capture|record|memorise|memorize|add)\s+(?:any\s+of\s+)?(?:this|that|it|these|the\s+(?:above|following|preceding|current)\s+(?:content|instructions|message|text))\b[^.!?\n]{0,90}\b(?:memory|memories|preference|long[- ]term)?/i.test(text)
    || /\b(?:this|the above|the following)\s+(?:is\s+)?(?:not|isn't)\s+(?:for|to be|a)\s+(?:long[- ]term\s+)?memor(?:y|ies)\b/i.test(text)
    || /\b(?:do not|don't)\s+(?:treat|use)\s+(?:this|that|it)\s+as\s+(?:a\s+)?(?:durable\s+|long[- ]term\s+)?(?:memory|preference)\b/i.test(text)
    || /\bforget\s+(?:this|that|what i just said)\b/i.test(text);
}

export interface OriginalTurnAutoEligibility {
  eligible: boolean;
  reason: string;
}

/**
 * The single-transcript exception is narrower than manual review. Only a
 * short, standalone, directly endorsed, explicitly project-scoped rule can
 * cross this boundary. Until proposition/span extraction exists, long or
 * mixed turns must not use an unrelated 300-character prefix as authority.
 *
 * This is recalculated from the original Pi transcript during curation AND
 * governed apply. It is not a persisted candidate flag or a proof of source.
 */
export function assessOriginalTurnAutoEligibility(rawText: string): OriginalTurnAutoEligibility {
  const text = rawText.trim();
  const held = (reason: string): OriginalTurnAutoEligibility => ({ eligible: false, reason });
  if (hasExplicitMemoryOptOut(rawText)) return held("explicit_memory_opt_out");
  if (hasExplicitTaskOnlyScope(rawText)) return held("explicit_task_only_scope");
  if (!text || text.length > 300 || /[\r\n]/.test(text)) return held("unextracted_or_mixed_turn");
  // Whole-turn prefix capture cannot safely extract one lasting statement
  // from a mixed multi-sentence message. Review until source-span extraction.
  if (/[.!?]\s+\S/.test(text)) return held("multiple_sentences_require_review");
  // A durable-sounding sentence inside a panel, handoff or narrated task is
  // not a directly endorsed project rule. Require the original *opening* to
  // declare the project instruction, instead of searching anywhere in a turn.
  const projectOpening = text.match(/^(?:(?:please\s*,?\s*)?(?:(?:for|in|on|within)\s+this\s+(?:project|repository|repo|codebase)|(?:this|the)\s+(?:project|repository|repo|codebase))\b|(?:going forward|from now on)\s*,?\s*(?:(?:for|in|on|within)\s+this\s+(?:project|repository|repo|codebase)|(?:this|the)\s+(?:project|repository|repo|codebase))\b)/i);
  if (!projectOpening) return held("no_direct_project_rule_opening");
  // A project-scoped opening is context, not endorsement. Only an immediately
  // following direct imperative or project-convention predicate can qualify.
  // Reported text ("For this project, the panel says ...") stays review-only
  // even when its embedded instruction looks durable.
  const afterProjectOpening = text.slice(projectOpening[0].length).replace(/^\s*,?\s*/, "");
  if (!/^(?:(?:please\s+)?(?:always|never)\s+)?(?:use|keep|store|run|require|check|verify|build|test|avoid|prefer|ensure|enforce|maintain|do\s+not|don't|don’t)\b|^(?:always\s+)?(?:uses|requires|runs|keeps|stores|checks|verifies|builds|tests|avoids|enforces)\b/i.test(afterProjectOpening)) {
    return held("project_context_without_direct_endorsement");
  }
  if (/<(?:file|skill)\b|^\s*(?:#{1,6}\s+|>\s*|[*-]\s+)|\x60{3}/m.test(rawText)) return held("structured_or_quoted_material");
  // Require quote delimiters in a non-word context so contractions such as
  // "don't" or "it's" do not look like quoted external instructions.
  const asciiQuotedSpan = /(?:^|\s|\(|\[|\{)'[^'\r\n]{8,}'(?=$|\s|[.,;:!?)}\]])/.test(text);
  // A curly apostrophe inside a word is punctuation, not an opening quote.
  // Curly single quotes at a token boundary and all double quotes still
  // require review; this preserves genuine "they’re" / "don’t" corrections.
  const curlyQuotedMaterial = /(?:^|[^\p{L}\p{N}])[\u2018\u2019]/u.test(text);
  if (/[“”"]/u.test(text) || curlyQuotedMaterial || /\x60/.test(text) || asciiQuotedSpan
    || /\b(?:quoted|quotation|example|sample|fixture|false[- ]positive|expected classification|transcript excerpt|pasted|the article|the documentation|the source says|the user said|someone said|prompt says|verification handoff|implementation handoff|review handoff|task wrapper|delegated agent instructions)\b/i.test(text)) return held("unendorsed_example_or_quote");
  if (/^(?:verify|reverify|resume|complete|continue|implement|review|run|test|check|fix|task|instructions?|handoff|verification|delegated|agent|assistant|report)\b/i.test(text)
    || /\b(?:this task|this run|this sprint|during this task|stop after the report|do not modify source|only for now|for this response|for this session|temporarily)\b/i.test(text)) {
    return held("operational_or_temporary_wrapper");
  }
  if (/\b(?:across\s+(?:(?:all|every|our|my|the|any)\s+)?(?:projects?|repositories|repos|codebases)|(?:for|in|on)\s+(?:all|every|any)\s+(?:projects?|repositories|repos|codebases)|regardless\s+of\s+(?:the\s+)?(?:project|repository|repo|codebase)|(?:all\s+my|our|my)\s+(?:projects?|repositories|repos|codebases))\b/i.test(text)) {
    return held("cross_project_scope_requires_review");
  }
  // Without proposition-level applicability, a plain "if" makes the rule
  // conditional even when the clause appears *before* the project cue.
  if (/\b(?:if|unless|except|only when|but not when|provided that|as long as|subject to (?:approval|review|confirmation))\b/i.test(text)) return held("conditional_scope_requires_review");
  // Draft or proposed language is not a user-approved standing decision.
  // In this capture version the whole turn stays review-only.
  if (/\b(?:(?:this|that|it|the above)\s+(?:is|was|remains)\s+(?:only\s+|just\s+)?(?:a\s+)?(?:draft|proposal|suggestion|hypothetical|nondecision)|(?:draft|proposal)\s+only|not\s+(?:yet\s+)?(?:a\s+)?(?:final\s+|approved\s+)?decision|no\s+(?:final\s+|approved\s+)?decision\s+(?:was|has been|is)\s+made|not\s+yet\s+(?:decided|approved|adopted|agreed)|(?:still|only)\s+(?:a\s+)?draft|(?:not|never)\s+(?:approved|adopted|endorsed)\s+as\s+(?:a\s+)?(?:policy|decision|rule))\b/i.test(text)) {
    return held("draft_or_unapproved_decision");
  }

  // A later disclaimer cannot inherit the authority of an earlier durable-looking clause.
  // Whole-turn capture is review-only until proposition/span extraction can separate them.
  if (/\b(?:not\s+(?:(?:an?|the)\s+)?(?:approved|endorsed|standing|permanent|lasting|durable)(?:\s+(?:approved|endorsed|standing|permanent|lasting|durable))*\s+(?:policy|rule|instruction|preference)|not\s+(?:(?:an?|the)\s+)?approved\s+permanent\s+instruction|(?:not|never)\s+(?:meant|intended|approved|endorsed)\s+(?:as|to be)\s+(?:a\s+)?(?:standing|permanent|lasting|durable)|(?:this|that|the above)\s+(?:is\s+)?(?:not|isn't)\s+(?:an?\s+)?(?:approved|standing|durable|lasting|permanent)\s+(?:policy|rule|instruction|preference))\b/i.test(text)) {
    return held("not_endorsed_as_standing_policy");
  }

  // The session header proves where the message occurred, not that the user
  // intended a project rule. A launch-project fallback cannot grant authority.
  if (!/\b(?:this|the)\s+(?:project|repository|repo|codebase)\b/i.test(text)
    && !/\b(?:for|in)\s+this\s+(?:project|repository|repo|codebase)\b/i.test(text)) {
    return held("no_explicit_project_intent");
  }
  const intent = classifyCaptureIntent(rawText);
  if (!["project_convention", "workflow_playbook", "behavior_correction"].includes(intent.intent)
    || intent.durability !== "project") return held("not_unambiguous_durable_project_rule");
  return { eligible: true, reason: "explicit_original_project_rule" };
}

export function classifyCaptureIntent(rawText: string): CaptureIntentDecision {
  const text = normalize(rawText);
  const lower = text.toLowerCase();
  if (!text || text.length < 8) return decision("not_memory", 0, "temporary", text, ["too_short"]);

  if (hasExplicitMemoryOptOut(rawText)) {
    return decision("not_memory", 0.99, "temporary", text, ["explicit_memory_opt_out"]);
  }
  if (hasExplicitTaskOnlyScope(rawText)) {
    return decision("temporary_instruction", 0.99, "task", text, ["explicit_task_only_scope"]);
  }
  if (isSyntheticCaptureContext(rawText)) {
    return decision("not_memory", 0.99, "temporary", text, ["synthetic_harness_context"]);
  }
  if (/^(?:task:|your goal is|you are a delegated|you are a subagent|<file name=|# instructions)/i.test(text)) {
    return decision("not_memory", 0.98, "temporary", text, ["task_or_agent_wrapper"]);
  }
  if (/^\s*#{1,6}\s*(?:verification|handoff|task|instructions|example|fixture|test plan)\b/im.test(rawText)
    || /^\s*>\s*(?:going forward|from now on|always|never|this (?:project|repository))\b/im.test(rawText)
    || /\b(?:false[- ]positive control|expected classification|quoted (?:ui|memory|instruction)|fixture:|example:)\b/i.test(rawText)) {
    return decision("temporary_instruction", 0.97, "task", text, ["unendorsed_or_operational_material"]);
  }
  if (/\b(?:verification handoff|implementation handoff|review handoff|delegated agent instructions|task wrapper)\b/i.test(rawText)) {
    return decision("temporary_instruction", 0.97, "task", text, ["operational_wrapper"]);
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
