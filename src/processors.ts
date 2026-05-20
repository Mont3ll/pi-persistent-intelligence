import type { MemoryRecord, ProcessorTrace, SessionContext } from "./types";

export interface MemoryProcessorOutput {
  records: MemoryRecord[];
  traces: ProcessorTrace[];
}

function trace(processor: string, input: MemoryRecord[], output: MemoryRecord[], exclusion_reasons: Record<string, string>): ProcessorTrace {
  return {
    processor,
    input_count: input.length,
    output_count: output.length,
    excluded_ids: Object.keys(exclusion_reasons),
    exclusion_reasons,
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function contextProjectKeys(context: SessionContext): Set<string> {
  const keys = new Set<string>();
  if (context.repository_id) keys.add(normalize(context.repository_id));
  if (context.project_root) keys.add(normalize(context.project_root.split(/[\\/]/).filter(Boolean).at(-1) ?? context.project_root));
  if (context.working_directory) keys.add(normalize(context.working_directory.split(/[\\/]/).filter(Boolean).at(-1) ?? context.working_directory));
  return keys;
}

function contextText(context: SessionContext): string {
  return [
    context.latest_user_message,
    context.first_user_message,
    context.task_intent,
    context.working_directory,
    ...(context.recent_files_touched ?? []),
    ...context.detected_domain_tags,
  ].filter(Boolean).join(" ").toLowerCase();
}

function phraseMatchesContext(phrase: string, text: string): boolean {
  const normalized = phrase.trim().toLowerCase();
  if (!normalized) return false;
  if (text.includes(normalized) || normalize(text).includes(normalize(normalized))) return true;
  const phraseTokens = normalized.split(/[^a-z0-9]+/).filter((token) => token.length > 3);
  const textTokens = text.split(/[^a-z0-9]+/).filter(Boolean);
  return phraseTokens.some((phraseToken) =>
    textTokens.some((textToken) => textToken.startsWith(phraseToken.slice(0, 7)) || phraseToken.startsWith(textToken.slice(0, 7))),
  );
}

export function statusFilterProcessor(records: MemoryRecord[], _context: SessionContext): { records: MemoryRecord[]; trace: ProcessorTrace } {
  const exclusionReasons: Record<string, string> = {};
  const output = records.filter((record) => {
    if (record.status === "active") return true;
    exclusionReasons[record.id] = `status:${record.status}`;
    return false;
  });
  return { records: output, trace: trace("StatusFilterProcessor", records, output, exclusionReasons) };
}

export function profileScopeProcessor(records: MemoryRecord[], context: SessionContext): { records: MemoryRecord[]; trace: ProcessorTrace } {
  const exclusionReasons: Record<string, string> = {};
  const output = records.filter((record) => {
    // Backward compatibility: v0.7.x records do not have profile_id. Treat them
    // as eligible for the resolved default profile and let scope/relevance narrow.
    if (!record.profile_id) return true;
    if (record.profile_id === context.profile_id) return true;
    exclusionReasons[record.id] = `profile_mismatch:${record.profile_id}`;
    return false;
  });
  return { records: output, trace: trace("ProfileScopeProcessor", records, output, exclusionReasons) };
}

export function negativeScopeProcessor(records: MemoryRecord[], context: SessionContext): { records: MemoryRecord[]; trace: ProcessorTrace } {
  const exclusionReasons: Record<string, string> = {};
  const text = contextText(context);
  const output = records.filter((record) => {
    for (const phrase of record.does_not_apply_when ?? []) {
      if (phraseMatchesContext(phrase, text)) {
        exclusionReasons[record.id] = `does_not_apply_when:${phrase}`;
        return false;
      }
    }
    for (const phrase of record.known_exceptions ?? []) {
      if (phraseMatchesContext(phrase, text)) {
        exclusionReasons[record.id] = `known_exceptions:${phrase}`;
        return false;
      }
    }
    return true;
  });
  return { records: output, trace: trace("NegativeScopeProcessor", records, output, exclusionReasons) };
}

export function basicScopeProcessor(records: MemoryRecord[], context: SessionContext): { records: MemoryRecord[]; trace: ProcessorTrace } {
  const exclusionReasons: Record<string, string> = {};
  const projectKeys = contextProjectKeys(context);
  const output = records.filter((record) => {
    if (record.layer === "L1") return true;
    if (record.scope.type === "global" || record.scope.type === "domain") return true;
    if (record.scope.type === "project") {
      const project = record.scope.project ? normalize(record.scope.project) : "";
      if (!project || projectKeys.has(project)) return true;
      exclusionReasons[record.id] = `project_scope_mismatch:${record.scope.project}`;
      return false;
    }
    return true;
  });
  return { records: output, trace: trace("BasicScopeProcessor", records, output, exclusionReasons) };
}

export function runMemoryProcessorPipeline(records: MemoryRecord[], context: SessionContext): MemoryProcessorOutput {
  const traces: ProcessorTrace[] = [];
  let current = records;
  for (const processor of [statusFilterProcessor, profileScopeProcessor, basicScopeProcessor, negativeScopeProcessor]) {
    const result = processor(current, context);
    current = result.records;
    traces.push(result.trace);
  }
  return { records: current, traces };
}
