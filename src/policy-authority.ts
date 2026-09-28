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

export function hasValidPolicyRatification(record: MemoryRecord): boolean {
  const ratification = record.policy_ratification;
  if (record.authority_plane !== "policy" || !ratification) return false;
  if (!EXPLICIT_POLICY_RATIFICATION_METHODS.has(ratification.method)) return false;
  if (!ratification.ratified_at || ratification.evidence_refs.length === 0) return false;

  const recordEvidence = new Set(record.evidence.map((item) => item.ref));
  return ratification.evidence_refs.every((ref) => recordEvidence.has(ref));
}

export function hasDirectiveAuthority(record: MemoryRecord, mode: GovernanceMode): boolean {
  if (mode === "compatibility") return true;
  return hasValidPolicyRatification(record);
}
