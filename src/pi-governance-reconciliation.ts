import type { PiGovernanceBundle } from "./pi-governance-compat";

export interface ReconciliationSection {
  source_only_ids: string[];
  destination_only_ids: string[];
  matching_ids: string[];
  divergent_ids: string[];
  source_duplicate_ids: string[];
  destination_duplicate_ids: string[];
  conflicting_duplicate_ids: string[];
}

export interface ReconciliationReport {
  dry_run: true;
  mutation_performed: false;
  source_identity: Record<string, unknown>;
  destination_identity: Record<string, unknown>;
  sections: Record<string, ReconciliationSection>;
  artifact_counts: Record<string, { source: number; destination: number; delta: number }>;
  mapping_changes: Array<Record<string, unknown>>;
  redaction_omissions: string[];
  warnings: string[];
}

const SECTION_NAMES = ["records", "patches", "evidence", "inquiries", "sessions", "reinforcement", "events", "tombstones"] as const;
const SET_ARRAY_KEYS = new Set([
  "tags", "evidence", "evidence_ids", "supersedes", "superseded_by", "related_memory_ids",
  "related_evidence_ids", "record_ids", "sessions_touched", "fields_checked", "fields_redacted",
]);

function stableString(value: unknown): string {
  return JSON.stringify(value);
}

function normalizeSemantic(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map((item) => normalizeSemantic(item));
    return SET_ARRAY_KEYS.has(key ?? "") ? items.sort((a, b) => stableString(a).localeCompare(stableString(b))) : items;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([childKey, child]) => [childKey, normalizeSemantic(child, childKey)]));
}

function artifactId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" && id ? id : null;
}

interface GroupedArtifacts {
  groups: Map<string, unknown[]>;
  duplicate_ids: string[];
  conflicting_ids: string[];
}

function groupArtifacts(values: unknown[]): GroupedArtifacts {
  const groups = new Map<string, unknown[]>();
  for (const value of values) {
    const id = artifactId(value);
    if (!id) continue;
    const group = groups.get(id) ?? [];
    group.push(normalizeSemantic(value));
    groups.set(id, group);
  }
  const duplicateIds: string[] = [];
  const conflictingIds: string[] = [];
  for (const [id, group] of groups) {
    if (group.length < 2) continue;
    duplicateIds.push(id);
    if (new Set(group.map(stableString)).size > 1) conflictingIds.push(id);
  }
  return {
    groups,
    duplicate_ids: duplicateIds.sort(),
    conflicting_ids: conflictingIds.sort(),
  };
}

function compareSection(sourceValues: unknown[], destinationValues: unknown[]): ReconciliationSection {
  const source = groupArtifacts(sourceValues);
  const destination = groupArtifacts(destinationValues);
  const sourceIds = new Set(source.groups.keys());
  const destinationIds = new Set(destination.groups.keys());
  const shared = [...sourceIds].filter((id) => destinationIds.has(id)).sort();
  const matching: string[] = [];
  const divergent: string[] = [];
  for (const id of shared) {
    const sourceForms = new Set(source.groups.get(id)!.map(stableString));
    const destinationForms = new Set(destination.groups.get(id)!.map(stableString));
    const same = sourceForms.size === destinationForms.size && [...sourceForms].every((form) => destinationForms.has(form));
    (same ? matching : divergent).push(id);
  }
  return {
    source_only_ids: [...sourceIds].filter((id) => !destinationIds.has(id)).sort(),
    destination_only_ids: [...destinationIds].filter((id) => !sourceIds.has(id)).sort(),
    matching_ids: matching,
    divergent_ids: divergent,
    source_duplicate_ids: source.duplicate_ids,
    destination_duplicate_ids: destination.duplicate_ids,
    conflicting_duplicate_ids: [...new Set([...source.conflicting_ids, ...destination.conflicting_ids])].sort(),
  };
}

function identity(bundle: PiGovernanceBundle): Record<string, unknown> {
  return {
    format: bundle.format,
    namespace: bundle.namespace ?? "default",
    producer: bundle.producer?.name ?? "unknown",
  };
}

export function reconcilePiGovernanceBundles(source: PiGovernanceBundle, destination: PiGovernanceBundle): ReconciliationReport {
  const sections: Record<string, ReconciliationSection> = {};
  const artifactCounts: ReconciliationReport["artifact_counts"] = {};
  for (const name of SECTION_NAMES) {
    const sourceValues = (source[name] ?? []) as unknown[];
    const destinationValues = (destination[name] ?? []) as unknown[];
    sections[name] = compareSection(sourceValues, destinationValues);
    artifactCounts[name] = {
      source: sourceValues.length,
      destination: destinationValues.length,
      delta: sourceValues.length - destinationValues.length,
    };
  }
  return {
    dry_run: true,
    mutation_performed: false,
    source_identity: identity(source),
    destination_identity: identity(destination),
    sections,
    artifact_counts: artifactCounts,
    mapping_changes: [],
    redaction_omissions: [],
    warnings: [...new Set([...(source.warnings ?? []), ...(destination.warnings ?? [])])].sort(),
  };
}
