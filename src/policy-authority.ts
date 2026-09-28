import type { GovernanceMode, MemoryRecord } from "./types";

export type AuthorityPlane = "evidence" | "belief" | "policy";
export type PolicyRatificationMethod = "direct_user_instruction" | "user_correction" | "explicit_config" | "manual_review";

export interface PolicyRatification {
  method: PolicyRatificationMethod;
  evidence_refs: string[];
  ratified_at: string;
}

declare module "./types" {
  interface MemoryRecord {
    /** Explicit epistemic/authority plane. Legacy records without this field are beliefs in strict mode. */
    authority_plane?: AuthorityPlane;
    /** Explicit provenance required before strict governance treats a record as directive policy. */
    policy_ratification?: PolicyRatification;
  }
}

const EXPLICIT_POLICY_RATIFICATION_METHODS = new Set<PolicyRatificationMethod>([
  "direct_user_instruction",
  "user_correction",
  "explicit_config",
  "manual_review",
]);

function isPolicyRatification(value: unknown): value is PolicyRatification {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<PolicyRatification>;
  if (typeof candidate.method !== "string" || !EXPLICIT_POLICY_RATIFICATION_METHODS.has(candidate.method as PolicyRatificationMethod)) return false;
  if (typeof candidate.ratified_at !== "string" || candidate.ratified_at.trim().length === 0) return false;
  if (!Array.isArray(candidate.evidence_refs) || candidate.evidence_refs.length === 0) return false;
  return candidate.evidence_refs.every((ref) => typeof ref === "string" && ref.trim().length > 0);
}

export function hasValidPolicyRatification(record: MemoryRecord): boolean {
  if (record.authority_plane !== "policy") return false;
  const ratification = record.policy_ratification as unknown;
  if (!isPolicyRatification(ratification)) return false;

  const recordEvidence = new Set(record.evidence.map((item) => item.ref));
  return ratification.evidence_refs.every((ref) => recordEvidence.has(ref));
}

export function hasDirectiveAuthority(record: MemoryRecord, mode: GovernanceMode): boolean {
  if (mode === "compatibility") return true;
  return hasValidPolicyRatification(record);
}
