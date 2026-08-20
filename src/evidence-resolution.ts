import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { boundSourceSummary, createEvidenceId } from "./evidence";
import { scanSecrets, shouldBlockPersistence } from "./secret-scanner";
import type { DurabilitySignal, EvidenceRecord, EvidenceTrustClass } from "./types";

export type EvidenceResolutionReason = "sourceMissing" | "sourceOutsideStore" | "sourceAmbiguous" | "sourceRedacted" | "secretDetected" | "unsupportedReference";

export type EvidenceResolution =
  | { status: "alreadyStructured"; evidenceId: string }
  | { status: "resolved"; evidence: EvidenceRecord; sourceSha256: string }
  | { status: "unresolved"; reason: EvidenceResolutionReason };

export interface EvidenceResolutionInput {
  root: string;
  reference: string;
  existingEvidence: EvidenceRecord[];
  memoryId: string;
  resourceId: string;
  profileId: string;
  createdAt: string;
  scopeLevel: string;
  scopeRef?: string;
  candidateText?: string;
  candidateTrustClass?: EvidenceTrustClass;
  candidateDurability?: DurabilitySignal;
  provenance?: "legacy_evidence_backfill_v2" | "curation_evidence_v1";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolvedEvidence(input: EvidenceResolutionInput, sourceText: string, sessionId?: string, sourceFile?: string): EvidenceResolution {
  if (shouldBlockPersistence(scanSecrets(sourceText))) return { status: "unresolved", reason: "secretDetected" };
  const sourceKind = sessionId || input.reference.replaceAll("\\", "/").startsWith("daily/") ? "conversation" : "file";
  const sourceSummary = boundSourceSummary(sourceText.trim().replace(/\s+/g, " ") || `Legacy source ${input.reference}`);
  const id = createEvidenceId({ profile_id: input.profileId, source_kind: sourceKind, source_ref: input.reference, source_summary: sourceSummary });
  const existing = input.existingEvidence.find((item) => item.id === id);
  if (existing) {
    if (existing.redaction_status === "redacted" || existing.redaction_status === "deleted") return { status: "unresolved", reason: "sourceRedacted" };
    return compatibleEvidence(existing, input) ? { status: "alreadyStructured", evidenceId: id } : { status: "unresolved", reason: "sourceAmbiguous" };
  }
  const provenance = input.provenance ?? "legacy_evidence_backfill_v2";
  return {
    status: "resolved",
    sourceSha256: sha256(sourceText),
    evidence: {
      id,
      resource_id: input.resourceId,
      profile_id: input.profileId,
      created_at: input.createdAt,
      source_kind: sourceKind,
      source_session_id: sessionId,
      source_file: sourceFile,
      source_ref: input.reference,
      source_summary: sourceSummary,
      trust_class: input.candidateTrustClass ?? "unknown",
      polarity: "supports",
      durability_signal: input.candidateDurability ?? "unknown",
      related_memory_ids: [input.memoryId],
      scope_level: input.scopeLevel,
      scope_ref: input.scopeRef,
      tags: [provenance.replaceAll("_", "-")],
      notes: provenance,
    },
  };
}

function compatibleEvidence(evidence: EvidenceRecord, input: EvidenceResolutionInput): boolean {
  return evidence.profile_id === input.profileId
    && evidence.resource_id === input.resourceId
    && evidence.polarity === "supports";
}

export function resolveEvidenceReference(input: EvidenceResolutionInput): EvidenceResolution {
  const existing = input.existingEvidence.find((item) => item.id === input.reference);
  if (existing) {
    if (existing.redaction_status === "redacted" || existing.redaction_status === "deleted") return { status: "unresolved", reason: "sourceRedacted" };
    return compatibleEvidence(existing, input) ? { status: "alreadyStructured", evidenceId: existing.id } : { status: "unresolved", reason: "sourceAmbiguous" };
  }

  if (/^session:[^:]+:turn:[^:]+$/.test(input.reference)) return { status: "unresolved", reason: "sourceMissing" };
  if (!input.reference.trim() || input.reference.includes(":")) return { status: "unresolved", reason: "unsupportedReference" };

  const rootPath = realpathSync(input.root);
  const candidate = isAbsolute(input.reference) ? resolve(input.reference) : resolve(input.root, input.reference);
  const lexicalRelative = relative(rootPath, candidate);
  if (lexicalRelative.startsWith("..") || isAbsolute(lexicalRelative)) return { status: "unresolved", reason: "sourceOutsideStore" };
  if (!existsSync(candidate)) return { status: "unresolved", reason: "sourceMissing" };
  const realCandidate = realpathSync(candidate);
  if (!statSync(realCandidate).isFile()) return { status: "unresolved", reason: "sourceAmbiguous" };
  const realRelative = relative(rootPath, realCandidate);
  if (realRelative.startsWith("..") || isAbsolute(realRelative)) return { status: "unresolved", reason: "sourceOutsideStore" };
  return resolvedEvidence(input, readFileSync(realCandidate, "utf8"), undefined, input.reference);
}
