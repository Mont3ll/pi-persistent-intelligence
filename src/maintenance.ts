import type { MaintenanceRecommendation, MaintenanceRecommendationKind, MemoryPatch, MemoryRecord, PatchOp, ReinforcementSummary, Stability } from "./types";

const STABILITY_LEVELS: Record<Stability, number> = { low: 0, "semi-stable": 1, stable: 2 };

function higherStability(a: Stability, b: Stability): Stability {
  return STABILITY_LEVELS[a] >= STABILITY_LEVELS[b] ? a : b;
}

function lowerStability(a: Stability): Stability {
  if (a === "stable") return "semi-stable";
  return "low";
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function isOverdue(nextReview: string, today: string): boolean {
  return nextReview < today;
}

export function generateMaintenanceRecommendations(
  records: MemoryRecord[],
  summaries: ReinforcementSummary[],
  now = new Date().toISOString(),
): MaintenanceRecommendation[] {
  const today = dateOnly(now);
  const summaryMap = new Map(summaries.map((s) => [s.memory_id, s]));
  const recommendations: MaintenanceRecommendation[] = [];

  for (const record of records) {
    const summary = summaryMap.get(record.id);

    // Overdue review
    if (isOverdue(record.review.next_review, today)) {
      recommendations.push({
        memory_id: record.id,
        kind: "review_due",
        reason: `Review date ${record.review.next_review} is overdue as of ${today}.`,
        requires_review: true,
        current_stability: record.stability,
        reinforcement_summary: summary,
      });
    }

    if (!summary) continue;

    const { explicit_correction, explicit_reinforcement, implicit_success, neutral_exposure } = summary.counts;

    // Explicit correction: recommend review + decrease
    if (explicit_correction >= 1) {
      recommendations.push({
        memory_id: record.id,
        kind: "review_memory",
        reason: `${explicit_correction} explicit correction(s) detected. Memory may be incorrect or stale.`,
        requires_review: true,
        current_stability: record.stability,
        suggested_stability: "low",
        reinforcement_summary: summary,
      });
      recommendations.push({
        memory_id: record.id,
        kind: "decrease_stability",
        reason: `Explicit correction outweighs implicit success; stability should decrease.`,
        requires_review: true,
        current_stability: record.stability,
        suggested_stability: lowerStability(record.stability),
        reinforcement_summary: summary,
      });
      if (explicit_correction >= 2) {
        recommendations.push({
          memory_id: record.id,
          kind: "mark_contested_suggestion",
          reason: `Multiple explicit corrections suggest this memory should be contested pending review.`,
          requires_review: true,
          current_stability: record.stability,
          reinforcement_summary: summary,
        });
      }
      continue;
    }

    // Explicit reinforcement: strong positive signal
    if (explicit_reinforcement >= 2 && explicit_correction === 0) {
      recommendations.push({
        memory_id: record.id,
        kind: "increase_stability",
        reason: `${explicit_reinforcement} explicit reinforcement(s) with no corrections; stability can increase.`,
        requires_review: false,
        current_stability: record.stability,
        suggested_stability: "stable",
        reinforcement_summary: summary,
      });
      continue;
    }

    // Implicit success alone: at most semi-stable (never full stable)
    if (implicit_success >= 5 && explicit_correction === 0 && explicit_reinforcement === 0 && neutral_exposure === 0) {
      const suggested: Stability = higherStability("semi-stable", record.stability);
      if (suggested === "stable" && record.stability !== "stable") {
        // block implicit success from promoting to stable
        recommendations.push({
          memory_id: record.id,
          kind: "flag_for_review",
          reason: `${implicit_success} implicit success events suggest semi-stable is appropriate, but not stable without explicit reinforcement.`,
          requires_review: false,
          current_stability: record.stability,
          suggested_stability: "semi-stable",
          reinforcement_summary: summary,
        });
      }
    }
  }

  return recommendations;
}

export function buildStabilityPatchFromRecommendations(
  recommendations: MaintenanceRecommendation[],
  now: string,
): MemoryPatch {
  const ops: PatchOp[] = [];
  let opIndex = 0;

  for (const rec of recommendations) {
    if (rec.kind !== "increase_stability" && rec.kind !== "decrease_stability") continue;
    const suggested = rec.suggested_stability;
    if (!suggested) continue;

    opIndex++;
    ops.push({
      op_id: `op_${String(opIndex).padStart(3, "0")}`,
      op: "update_stability",
      target_id: rec.memory_id,
      updates: { stability: suggested, updated_at: dateOnly(now) },
      reason: rec.reason,
      rationale: `Reinforcement-based stability ${rec.kind === "increase_stability" ? "increase" : "decrease"} from ${rec.current_stability} to ${suggested}.`,
      risk: rec.kind === "decrease_stability" ? "medium" : "low",
      default_selected: !rec.requires_review,
    });
  }

  const stamp = now.replace(/[-:T]/g, "").slice(0, 12);
  return {
    patch_id: `patch_${stamp}_stability_001`,
    created_at: now,
    generated_by: "maintainer",
    mode: "propose",
    summary: ops.length > 0 ? `Stability update for ${ops.length} memory record(s).` : "No stability updates required.",
    ops,
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}

export function generateMaintenanceReport(
  recommendations: MaintenanceRecommendation[],
  records: MemoryRecord[],
): string {
  if (recommendations.length === 0) return "# Maintenance Report\n\nNo maintenance recommendations.\n";

  const recordMap = new Map(records.map((r) => [r.id, r]));
  const byMemory = new Map<string, MaintenanceRecommendation[]>();
  for (const rec of recommendations) {
    if (!byMemory.has(rec.memory_id)) byMemory.set(rec.memory_id, []);
    byMemory.get(rec.memory_id)!.push(rec);
  }

  const lines: string[] = ["# Maintenance Report", "", `Generated: ${new Date().toISOString()}`, ""];
  lines.push(`## Summary`, "", `${byMemory.size} record(s) with ${recommendations.length} recommendation(s).`, "");

  for (const [memoryId, recs] of byMemory) {
    const record = recordMap.get(memoryId);
    lines.push(`### ${memoryId}`);
    if (record) {
      lines.push("", `**Statement:** ${record.statement}`, `**Current stability:** ${record.stability}  **Confidence:** ${record.confidence.toFixed(2)}`, "");
    }
    for (const rec of recs) {
      const reviewBadge = rec.requires_review ? " ⚠️ review required" : "";
      lines.push(`- **${rec.kind}**${reviewBadge}: ${rec.reason}`);
      if (rec.suggested_stability) lines.push(`  → Suggested stability: ${rec.suggested_stability}`);
      if (rec.reinforcement_summary) {
        const { counts } = rec.reinforcement_summary;
        lines.push(`  → Reinforcement: ${counts.explicit_reinforcement}× reinforced, ${counts.explicit_correction}× corrected, ${counts.implicit_success}× implicit success, ${counts.neutral_exposure}× neutral`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
