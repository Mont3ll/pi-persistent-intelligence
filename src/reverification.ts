import { readEvidenceRecords } from "./evidence";
import { loadAllRecords } from "./store";

export interface ReverificationRecommendation {
  memory_id: string;
  priority: "medium" | "high";
  invalid_evidence_ids: string[];
  valid_evidence_ids: string[];
  reason: string;
}

export function generateReverificationRecommendations(root: string): ReverificationRecommendation[] {
  const evidence = new Map(readEvidenceRecords(root).map((record) => [record.id, record]));
  const recommendations: ReverificationRecommendation[] = [];

  for (const memory of loadAllRecords(root).filter((record) => record.status === "active" || record.status === "contested")) {
    const evidenceIds = [...new Set(memory.evidence.map((ev) => ev.ref))];
    const structured = evidenceIds.map((id) => evidence.get(id)).filter((ev): ev is NonNullable<typeof ev> => Boolean(ev));
    if (structured.length === 0) continue;
    const invalid = structured.filter((ev) => ev.redaction_status === "redacted" || ev.redaction_status === "deleted");
    if (invalid.length === 0) continue;
    const valid = structured.filter((ev) => ev.redaction_status !== "redacted" && ev.redaction_status !== "deleted");
    recommendations.push({
      memory_id: memory.id,
      priority: valid.length === 0 ? "high" : "medium",
      invalid_evidence_ids: invalid.map((ev) => ev.id).sort(),
      valid_evidence_ids: valid.map((ev) => ev.id).sort(),
      reason: valid.length === 0
        ? "All structured supporting evidence is redacted or deleted."
        : "Some structured supporting evidence is redacted or deleted.",
    });
  }

  return recommendations.sort((a, b) => a.memory_id.localeCompare(b.memory_id));
}
