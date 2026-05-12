export type MemoryLayer = "L1" | "L2" | "L3";
export type MemoryStatus = "active" | "deprecated" | "superseded" | "promoted";
export type Stability = "low" | "semi-stable" | "stable";
export type EvidenceType = "artifact" | "conversation" | "commit" | "source" | "manual";

export interface EvidenceRef {
  type: EvidenceType | string;
  ref: string;
  note: string;
}

export interface MemoryScope {
  type: "global" | "project" | "domain";
  project?: string;
  domains?: string[];
}

export interface MemoryReview {
  cadence_days: number;
  next_review: string;
  change_condition: string;
}

export interface MemoryRecord {
  id: string;
  layer: MemoryLayer;
  scope: MemoryScope;
  tags: string[];
  statement: string;
  evidence: EvidenceRef[];
  confidence: number;
  stability: Stability;
  created_at: string;
  updated_at: string;
  review: MemoryReview;
  status: MemoryStatus;
  supersedes: string[];
  superseded_by: string[];
  vault_ref: string | null;
}

export interface CaptureCandidate {
  id: string;
  created_at: string;
  source: { type: string; ref: string; cwd?: string };
  text: string;
  tags: string[];
  evidence_refs: string[];
  confidence?: number;
  status: "new" | "patched" | "rejected";
}

export type PatchOpType = "add" | "update" | "supersede" | "deprecate" | "decay" | "reject_candidate" | "promote_to_vault_candidate";

export interface PatchOp {
  op_id: string;
  op: PatchOpType;
  target?: string;
  target_id?: string;
  from?: string;
  record?: MemoryRecord;
  to_record?: MemoryRecord;
  updates?: Partial<MemoryRecord>;
  reason?: string;
  rationale?: string;
  risk: "low" | "medium" | "high";
  default_selected: boolean;
  candidate_id?: string;
}

export interface MemoryPatch {
  patch_id: string;
  created_at: string;
  generated_by: "curator" | "maintainer" | "manual";
  mode: "propose" | "supervised" | "auto";
  summary: string;
  ops: PatchOp[];
  status: "proposed" | "applied" | "partially_applied";
  applied_at: string | null;
  applied_ops: string[];
  skipped_ops: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!isObject(value)) return false;
  if (typeof value.id !== "string" || !value.id) return false;
  if (value.layer !== "L1" && value.layer !== "L2" && value.layer !== "L3") return false;
  if (!isObject(value.scope) || typeof value.scope.type !== "string") return false;
  if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string")) return false;
  if (typeof value.statement !== "string" || value.statement.trim().length === 0) return false;
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) return false;
  for (const evidence of value.evidence) {
    if (!isObject(evidence) || typeof evidence.ref !== "string" || typeof evidence.note !== "string") return false;
  }
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) return false;
  if (value.stability !== "low" && value.stability !== "semi-stable" && value.stability !== "stable") return false;
  if (typeof value.created_at !== "string" || typeof value.updated_at !== "string") return false;
  if (!isObject(value.review)) return false;
  if (typeof value.review.cadence_days !== "number") return false;
  if (typeof value.review.next_review !== "string") return false;
  if (typeof value.review.change_condition !== "string" || value.review.change_condition.trim().length === 0) return false;
  if (!Array.isArray(value.supersedes) || !Array.isArray(value.superseded_by)) return false;
  if (typeof value.status !== "string") return false;
  if (value.vault_ref !== null && typeof value.vault_ref !== "string") return false;
  return true;
}
