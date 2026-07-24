import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { ensureMemoryDirs } from "./paths";
import type { CaptureCandidate, MemoryPatch, PatchOp } from "./types";

const PURGED = "[privacy purged]";

function redactedCandidate(candidate: CaptureCandidate): CaptureCandidate {
  return {
    id: candidate.id,
    created_at: candidate.created_at,
    source: { type: "privacy_purge", ref: PURGED },
    text: PURGED,
    tags: [],
    evidence_refs: [],
    evidence_ids: [],
    confidence: 0,
    status: candidate.status,
  };
}

function directlyReferencesTarget(op: PatchOp, targetId: string): boolean {
  return op.target_id === targetId || op.record?.id === targetId || op.to_record?.id === targetId;
}

function correlatedCandidateIds(patch: MemoryPatch, targetId: string): string[] {
  return patch.ops
    .filter((op) => directlyReferencesTarget(op, targetId))
    .flatMap((op) => op.candidate_id ? [op.candidate_id] : []);
}

function redactedOp(op: PatchOp): PatchOp {
  return {
    op_id: op.op_id,
    op: "reject_candidate",
    risk: "high",
    default_selected: false,
    ...(op.target_id ? { target_id: op.target_id } : {}),
    ...(op.candidate_id ? { candidate_id: op.candidate_id } : {}),
    reason: PURGED,
    rationale: PURGED,
  };
}

function redactPatch(
  patch: MemoryPatch,
  targetId: string,
  candidateIds: Set<string>,
  preserveExecutablePrivacyDelete: boolean,
): { patch: MemoryPatch; changed: boolean } {
  let changed = false;
  const ops = patch.ops.map((op) => {
    const correlated = directlyReferencesTarget(op, targetId)
      || Boolean(op.candidate_id && candidateIds.has(op.candidate_id));
    if (!correlated) return op;
    if (
      preserveExecutablePrivacyDelete
      && op.op === "delete"
      && op.deletion_mode === "privacy_purge"
      && op.target_id === targetId
    ) return op;
    changed = true;
    return redactedOp(op);
  });
  return { patch: changed ? { ...patch, summary: PURGED, ops } : patch, changed };
}

function assertPatchShape(value: unknown): asserts value is MemoryPatch {
  if (!value || typeof value !== "object") throw new Error("Invalid privacy artifact patch shape");
  const patch = value as Record<string, unknown>;
  if (typeof patch.patch_id !== "string" || !Array.isArray(patch.ops)) throw new Error("Invalid privacy artifact patch shape");
  for (const op of patch.ops) {
    if (!op || typeof op !== "object" || typeof (op as Record<string, unknown>).op_id !== "string" || typeof (op as Record<string, unknown>).op !== "string") {
      throw new Error("Invalid privacy artifact patch operation shape");
    }
  }
}

function assertCandidateShape(value: unknown): asserts value is CaptureCandidate {
  if (!value || typeof value !== "object") throw new Error("Invalid privacy artifact candidate shape");
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string"
    || typeof candidate.created_at !== "string"
    || typeof candidate.text !== "string"
    || !Array.isArray(candidate.tags)
    || !Array.isArray(candidate.evidence_refs)
    || (candidate.matched_memory_ids !== undefined
      && (!Array.isArray(candidate.matched_memory_ids) || candidate.matched_memory_ids.some((id) => typeof id !== "string")))
    || !["new", "patched", "rejected"].includes(String(candidate.status))
  ) throw new Error("Invalid privacy artifact candidate shape");
}

function stage(file: string, content: string): string {
  const temporary = join(dirname(file), `.${basename(file)}.privacy-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeSync(fd, content, undefined, "utf-8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return temporary;
}

interface ArtifactChange { file: string; content: string; original: string }

export function validatePrivacyArtifactSet(root: string): void {
  const paths = ensureMemoryDirs(root);
  for (const name of readdirSync(paths.patches).filter((entry) => entry.endsWith(".json"))) {
    const parsed: unknown = JSON.parse(readFileSync(join(paths.patches, name), "utf-8"));
    assertPatchShape(parsed);
  }
  for (const line of readFileSync(paths.inbox.captured, "utf-8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed: unknown = JSON.parse(line);
    assertCandidateShape(parsed);
  }
}

function redactCurrentPrivacyPatch(
  patch: MemoryPatch,
  targetIds: string[],
  externallyCorrelatedCandidateIds: string[],
  preserveExecutablePrivacyDeletes: boolean,
): MemoryPatch {
  const candidateIds = new Set([
    ...externallyCorrelatedCandidateIds,
    ...targetIds.flatMap((targetId) => correlatedCandidateIds(patch, targetId)),
  ]);
  let changed = false;
  const ops = patch.ops.map((op) => {
    const correlated = targetIds.some((targetId) => directlyReferencesTarget(op, targetId))
      || Boolean(op.candidate_id && candidateIds.has(op.candidate_id));
    if (!correlated) return op;
    const executableDelete = preserveExecutablePrivacyDeletes
      && op.op === "delete"
      && op.deletion_mode === "privacy_purge"
      && Boolean(op.target_id && targetIds.includes(op.target_id));
    if (executableDelete) return op;
    changed = true;
    return redactedOp(op);
  });
  return changed ? { ...patch, summary: PURGED, ops } : patch;
}

export function collectPrivacyCandidateCorrelations(root: string, targetIds: string[]): string[] {
  const paths = ensureMemoryDirs(root);
  const ids = new Set<string>();
  for (const name of readdirSync(paths.patches).filter((entry) => entry.endsWith(".json"))) {
    const parsed: unknown = JSON.parse(readFileSync(join(paths.patches, name), "utf-8"));
    assertPatchShape(parsed);
    for (const targetId of targetIds) {
      for (const id of correlatedCandidateIds(parsed, targetId)) ids.add(id);
    }
  }
  for (const line of readFileSync(paths.inbox.captured, "utf-8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed: unknown = JSON.parse(line);
    assertCandidateShape(parsed);
    if (parsed.matched_memory_ids?.some((id) => targetIds.includes(id))) ids.add(parsed.id);
  }
  return [...ids];
}

export function redactPrivacyPatchForPersistence(
  patch: MemoryPatch,
  targetIds: string[],
  externallyCorrelatedCandidateIds: string[] = [],
): MemoryPatch {
  return redactCurrentPrivacyPatch(patch, targetIds, externallyCorrelatedCandidateIds, false);
}

export function redactPrivacyPatchForExecution(
  patch: MemoryPatch,
  targetIds: string[],
  externallyCorrelatedCandidateIds: string[] = [],
): MemoryPatch {
  return redactCurrentPrivacyPatch(patch, targetIds, externallyCorrelatedCandidateIds, true);
}

export function purgeCorrelatedPrivacyArtifacts(root: string, targetId: string): { changedFiles: string[] } {
  const paths = ensureMemoryDirs(root);
  const parsedPatches = readdirSync(paths.patches)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const file = join(paths.patches, name);
      const original = readFileSync(file, "utf-8");
      const parsed: unknown = JSON.parse(original);
      assertPatchShape(parsed);
      return { file, original, patch: parsed };
    });
  const candidateOriginal = readFileSync(paths.inbox.captured, "utf-8");
  const candidates = candidateOriginal
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      assertCandidateShape(parsed);
      return parsed;
    });
  const candidateIds = new Set([
    ...parsedPatches.flatMap(({ patch }) => correlatedCandidateIds(patch, targetId)),
    ...candidates
      .filter((candidate) => candidate.matched_memory_ids?.includes(targetId))
      .map((candidate) => candidate.id),
  ]);
  const patchResults = parsedPatches
    .map(({ file, original, patch }) => ({ file, original, ...redactPatch(patch, targetId, candidateIds, false) }))
    .filter((entry) => entry.changed);
  let candidatesChanged = false;
  const redactedCandidates = candidates.map((candidate) => {
    const directlyRelated = candidate.matched_memory_ids?.includes(targetId) ?? false;
    if (!candidateIds.has(candidate.id) && !directlyRelated) return candidate;
    candidatesChanged = true;
    return redactedCandidate(candidate);
  });

  const changes: ArtifactChange[] = [
    ...(candidatesChanged ? [{
      file: paths.inbox.captured,
      content: `${redactedCandidates.map((candidate) => JSON.stringify(candidate)).join("\n")}\n`,
      original: candidateOriginal,
    }] : []),
    ...patchResults.map((entry) => ({
      file: entry.file,
      content: `${JSON.stringify(entry.patch, null, 2)}\n`,
      original: entry.original,
    })),
  ];
  if (changes.length === 0) return { changedFiles: [] };

  const staged: Array<ArtifactChange & { temporary: string }> = [];
  let commitStarted = false;
  try {
    for (const change of changes) staged.push({ ...change, temporary: stage(change.file, change.content) });
    commitStarted = true;
    for (const change of staged) renameSync(change.temporary, change.file);
  } catch (error) {
    for (const change of staged) {
      if (existsSync(change.temporary)) unlinkSync(change.temporary);
    }
    if (commitStarted) {
      for (const change of changes) renameSync(stage(change.file, change.original), change.file);
    }
    throw error;
  }
  return { changedFiles: changes.map((change) => relative(root, change.file)) };
}
