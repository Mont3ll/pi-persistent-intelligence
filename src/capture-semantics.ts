import type { CaptureScopeTarget } from "./types";
import { classifyCaptureIntent, containsMemoryOptOut, hasCrossProjectOrGlobalCue } from "./capture-intent";

/**
 * Conservative automatic-promotion boundary, not a general memory classifier.
 *
 * A transcript match establishes authorship of the outer user turn. It does
 * not establish endorsement of examples, permanence, or intended scope. Until
 * proposition-level extraction is available, mixed/ambiguous turns are for
 * supervised review rather than one-source automatic writes.
 */
export type AutomaticSemanticHold =
  | "memory_opt_out"
  | "quoted_or_example_content"
  | "task_or_verification_handoff"
  | "temporary_or_mixed_turn"
  | "cross_project_or_global_scope"
  | "scope_not_explicitly_project"
  | "no_clear_durable_project_intent";

export type AutomaticSemanticDecision =
  | { eligible: true }
  | { eligible: false; reason: AutomaticSemanticHold };

function hasExplicitProjectCue(text: string): boolean {
  return /\b(?:(?:for|in|within)\s+this\s+(?:project|repository|repo|codebase)|this\s+(?:project|repository|repo|codebase)\s+(?:always\s+)?(?:uses|requires|runs|keeps|stores|must|should|never))\b/i.test(text);
}

function hasUnendorsedMaterial(text: string): boolean {
  return /(?:^|\n)\s*(?:> |\`\`\`|<file\b|<skill\b|<escape\b|\[example\]|#{1,6}\s*(?:example|sample|quoted|UI example|fixture)\b)/im.test(text)
    || /\b(?:(?:the|a)\s+(?:UI|panel|screenshot|example|sample|fixture|documentation|readme|source|prompt|transcript)\s+(?:says|shows|reads|contains|states|includes|uses)|(?:here(?:'s| is)\s+(?:a|an)\s+(?:example|sample|quote|fixture))|(?:quoted\s+(?:text|example|instruction))|(?:example\s*:\s*["'“]))\b/i.test(text)
    || /(?:^|\n)\s*(?:user|assistant|system|tool)\s*:\s*/im.test(text);
}

function isTaskHandoff(text: string): boolean {
  return /(?:^|\n)\s*(?:#{1,6}\s*)?(?:[A-Z][A-Z0-9_]{5,}_(?:RECHECK|ACCEPTANCE|HANDOFF|REPORT)|(?:verify|reverify|resume|complete|inspect|audit|review)\b[^\n]{0,130}\b(?:HEAD|SHA|branch|release|tests?|worktree|PR|verification)|(?:local[- ]agent|verifier|testing[- ]agent)\s+(?:handoff|report|instructions)|(?:verification|release|implementation|test)\s+(?:handoff|recheck|report))\b/im.test(text)
    || /(?:^|\n)\s*(?:HEAD|TREE|BASE|BOUNDED_DIFF|FOCUSED_TESTS|FULL_UNIT|READY_FOR_[A-Z_]+)\s*:/m
    || /\b(?:stop\s+after\s+the\s+report|do\s+not\s+(?:modify\s+(?:source|tests)|mutate\s+the\s+live\s+store|create\s+a\s+PR|publish\s+or\s+deploy))\b/i.test(text);
}

function hasTemporaryOrMixedContext(text: string): boolean {
  return /\b(?:for\s+this\s+(?:task|response|session|exercise|run|test)|during\s+this\s+(?:task|session|run)|(?:right\s+now|for\s+now|temporarily|only\s+this\s+time)|(?:this\s+(?:step|slice|stage|issue|ticket|bug|PR|request|response)\s+(?:only|is\s+only))|(?:once\s+(?:this|the)\s+(?:task|test|fix|PR)\s+(?:is|has)))\b/i.test(text)
    || /(?:^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|#{1,6}\s+)/m.test(text)
    || text.split(/\n/).filter((part) => part.trim()).length > 1;
}

export function assessSingleSourceAutoIntent(
  originalUserTurn: string,
  scope: CaptureScopeTarget | undefined,
): AutomaticSemanticDecision {
  if (containsMemoryOptOut(originalUserTurn)) return { eligible: false, reason: "memory_opt_out" };
  if (hasUnendorsedMaterial(originalUserTurn)) return { eligible: false, reason: "quoted_or_example_content" };
  if (isTaskHandoff(originalUserTurn)) return { eligible: false, reason: "task_or_verification_handoff" };
  if (hasTemporaryOrMixedContext(originalUserTurn) || originalUserTurn.trim().length > 300) {
    return { eligible: false, reason: "temporary_or_mixed_turn" };
  }
  if (hasCrossProjectOrGlobalCue(originalUserTurn)) {
    return { eligible: false, reason: "cross_project_or_global_scope" };
  }
  if (scope?.type !== "project" || !scope.project || !hasExplicitProjectCue(originalUserTurn)) {
    return { eligible: false, reason: "scope_not_explicitly_project" };
  }
  const intent = classifyCaptureIntent(originalUserTurn);
  if (!["project_convention", "workflow_playbook", "behavior_correction"].includes(intent.intent)
    || intent.durability !== "project"
    || intent.global_cues.length > 0) {
    return { eligible: false, reason: "no_clear_durable_project_intent" };
  }
  return { eligible: true };
}
