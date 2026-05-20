import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readEvidenceRecords } from "./evidence";
import { listCandidates } from "./inbox";
import { readOpenInquiries } from "./inquiries";
import { readDeletionTombstones } from "./tombstones";
import { loadActiveRecords, loadAllRecords, loadLayerRecords } from "./store";
import type {
  CandidateMatchKind,
  CounterexampleSearchResult,
  ExportableMemoryArtifact,
  MemoryHandoffSnapshot,
  MemoryRecord,
  MetaConsolidationCandidate,
  MetaConsolidationCluster,
  MetaConsolidationConfig,
  MetaConsolidationRun,
} from "./types";

// ─── Clustering ───────────────────────────────────────────────────────────────

const SAFE_STATUSES = new Set<MemoryRecord["status"]>(["active"]);

export const DEFAULT_META_CONSOLIDATION_CONFIG: MetaConsolidationConfig = {
  enabled: false,
  cadence: "manual",
  min_l2_records: 2,
  min_reinforcement_score: 0,
  max_candidates_per_run: 5,
  max_input_records: 50,
  require_counterexample_search: true,
};

export function clusterL2Records(records: MemoryRecord[], profileId: string): MetaConsolidationCluster[] {
  const eligible = records.filter((r) =>
    r.layer === "L2" &&
    SAFE_STATUSES.has(r.status) &&
    (!r.profile_id || r.profile_id === profileId),
  );

  const map = new Map<string, MemoryRecord[]>();
  for (const r of eligible) {
    const key = r.normalized_key ?? `${r.profile_id ?? "legacy"}|${r.ruleType ?? "memory"}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }

  const clusters: MetaConsolidationCluster[] = [];
  for (const [key, recs] of map) {
    if (recs.length < 1) continue;
    const confidences = recs.map((r) => r.confidence);
    const avgConf = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
    const exceptions = [...new Set(recs.flatMap((r) => r.known_exceptions ?? []))];
    const dnas = [...new Set(recs.flatMap((r) => r.does_not_apply_when ?? []))];
    clusters.push({
      cluster_key: key,
      profile_id: profileId,
      topic: recs[0].tags.find((t) => !["workflow", "preference", "correction", "testing", "tool", "architecture", "convention"].includes(t)) ?? recs[0].tags[0] ?? "memory",
      ruleType: recs[0].ruleType,
      normalized_keys: recs.map((r) => r.normalized_key ?? key),
      source_memory_ids: recs.map((r) => r.id),
      stability_scores: recs.map((r) => r.stability === "stable" ? 1 : r.stability === "semi-stable" ? 0.5 : 0),
      avg_confidence: Number(avgConf.toFixed(3)),
      known_exceptions: exceptions,
      does_not_apply_when: dnas,
    });
  }
  return clusters;
}

// ─── Counterexample search ────────────────────────────────────────────────────

export function searchCounterexamples(root: string, cluster: MetaConsolidationCluster, allRecords: MemoryRecord[]): CounterexampleSearchResult {
  const sourceSet = new Set(cluster.source_memory_ids);
  const sourcesChecked: string[] = [];

  const contested: string[] = [];
  for (const r of allRecords) {
    if (sourceSet.has(r.id) && r.status !== "active") {
      contested.push(r.id);
    }
    if (r.status === "contested" && sourceSet.has(r.id)) {
      contested.push(r.id);
      sourcesChecked.push(`contested:${r.id}`);
    }
  }
  sourcesChecked.push("active_records");

  const evidenceRecords = readEvidenceRecords(root);
  const unresolved: string[] = [];
  for (const ev of evidenceRecords) {
    if (ev.related_memory_ids.some((id) => sourceSet.has(id)) &&
      (ev.redaction_status === "deleted" || ev.redaction_status === "redacted")) {
      unresolved.push(`Evidence ${ev.id} linked to source memory is redacted or deleted — cannot support L1 abstraction.`);
    }
  }
  sourcesChecked.push("evidence_store");

  const tombstones = readDeletionTombstones(root);
  const tombstonesHit = tombstones
    .filter((t) => sourceSet.has(t.deleted_record_id))
    .map((t) => t.deleted_record_id);
  sourcesChecked.push("tombstones");

  const inquiries = readOpenInquiries(root).filter((inq) =>
    (!inq.profile_id || inq.profile_id === cluster.profile_id) &&
    (inq.related_memory_ids?.some((id) => sourceSet.has(id)) ||
      inq.tags.some((t) => cluster.topic.includes(t) || t.includes(cluster.topic)))
  );
  sourcesChecked.push("open_inquiries");

  const contradicting = allRecords.filter((r) =>
    !sourceSet.has(r.id) &&
    r.status === "active" &&
    r.normalized_key && cluster.normalized_keys.includes(r.normalized_key) &&
    r.profile_id !== cluster.profile_id,
  ).map((r) => r.id);

  return {
    performed: true,
    sources_checked: [...new Set(sourcesChecked)],
    contradicting_memory_ids: contradicting,
    contested_record_ids: [...new Set(contested)],
    known_exceptions: cluster.known_exceptions,
    open_inquiry_ids: inquiries.map((i) => i.id),
    tombstone_ids: tombstonesHit,
    unresolved_questions: unresolved,
  };
}

// ─── Candidate generation ─────────────────────────────────────────────────────

function candidateId(cluster: MetaConsolidationCluster, now: string): string {
  return `meta_${createHash("sha256").update(`${cluster.cluster_key}\n${now}`).digest("hex").slice(0, 12)}`;
}

function proposedStatement(cluster: MetaConsolidationCluster, records: MemoryRecord[]): string {
  const sources = records.filter((r) => cluster.source_memory_ids.includes(r.id));
  if (sources.length === 0) return `General principle around ${cluster.topic} (${cluster.ruleType ?? "memory"}).`;
  const longest = sources.reduce((best, r) => r.statement.length > best.statement.length ? r : best, sources[0]);
  return `[L1 Candidate] ${longest.statement} (abstracted from ${sources.length} L2 records; requires human review and ratification before applying as L1.)`;
}

export function generateMetaConsolidationCandidates(
  root: string,
  clusters: MetaConsolidationCluster[],
  allRecords: MemoryRecord[],
  config: MetaConsolidationConfig,
  now: string,
): MetaConsolidationCandidate[] {
  const candidates: MetaConsolidationCandidate[] = [];
  const evidenceRecords = readEvidenceRecords(root);

  for (const cluster of clusters) {
    if (candidates.length >= config.max_candidates_per_run) break;
    if (cluster.source_memory_ids.length < config.min_l2_records) continue;
    const counterex = searchCounterexamples(root, cluster, allRecords);
    if (counterex.tombstone_ids.length > 0 || counterex.contested_record_ids.length > 0) continue;
    const sourceEvidenceIds = evidenceRecords
      .filter((ev) => cluster.source_memory_ids.some((id) => ev.related_memory_ids.includes(id)) && ev.redaction_status !== "deleted")
      .map((ev) => ev.id);

    candidates.push({
      id: candidateId(cluster, now),
      proposed_layer: "L1",
      proposed_statement: proposedStatement(cluster, allRecords),
      profile_id: cluster.profile_id,
      source_l2_ids: cluster.source_memory_ids,
      source_evidence_ids: sourceEvidenceIds,
      proposed_applies_when: allRecords.filter((r) => cluster.source_memory_ids.includes(r.id) && r.applies_when).flatMap((r) => r.applies_when ?? []),
      proposed_does_not_apply_when: [...new Set(cluster.does_not_apply_when)],
      proposed_known_exceptions: [...new Set(cluster.known_exceptions)],
      counterexample_search: counterex,
      promotion_eligibility: "l1_review_only",
      rationale: `${cluster.source_memory_ids.length} stable L2 records share normalized key ${cluster.cluster_key}. Requires counterexample review and explicit human ratification before L1 promotion.`,
    });
  }
  return candidates;
}

// ─── Report generation ────────────────────────────────────────────────────────

function renderMdReport(run: MetaConsolidationRun): string {
  const lines = [
    "# Meta-Consolidation Report",
    "",
    `Generated: ${run.timestamp}`,
    `Profile: ${run.profile_id ?? "global"}`,
    "",
    "## Summary",
    "",
    `- Clusters found: ${run.clusters.length}`,
    `- L1 candidates proposed: ${run.candidates.length}`,
    `- Skipped clusters: ${Object.keys(run.skipped_reasons).length}`,
    "",
    "## Clusters",
    "",
  ];
  for (const cluster of run.clusters) {
    lines.push(`### Cluster: \`${cluster.cluster_key}\``);
    lines.push(`- Source memories: ${cluster.source_memory_ids.join(", ")}`);
    if (cluster.known_exceptions.length) lines.push(`- Known exceptions: ${cluster.known_exceptions.join("; ")}`);
    if (cluster.does_not_apply_when.length) lines.push(`- Does not apply when: ${cluster.does_not_apply_when.join("; ")}`);
    lines.push("");
  }
  if (run.candidates.length > 0) {
    lines.push("## Proposed L1 Candidates", "", "> All require explicit human review and ratification. None auto-applied.", "");
    for (const c of run.candidates) {
      lines.push(`### ${c.id}`);
      lines.push(`**Statement:** ${c.proposed_statement}`, "");
      lines.push(`**Source L2 records:** ${c.source_l2_ids.join(", ")}`);
      if (c.counterexample_search.open_inquiry_ids.length) lines.push(`**Open inquiries:** ${c.counterexample_search.open_inquiry_ids.join(", ")}`);
      if (c.counterexample_search.unresolved_questions.length) lines.push(`**Unresolved:** ${c.counterexample_search.unresolved_questions.join("; ")}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

// ─── Main orchestration ───────────────────────────────────────────────────────

export function runMetaConsolidation(root: string, config: MetaConsolidationConfig, profileId: string, now: string): MetaConsolidationRun {
  const allActive = loadActiveRecords(root);
  const inputRecords = allActive.slice(0, config.max_input_records);
  const clusters = clusterL2Records(inputRecords, profileId).filter((c) => c.source_memory_ids.length >= config.min_l2_records);
  const allRecords = loadAllRecords(root);
  const candidates = generateMetaConsolidationCandidates(root, clusters, allRecords, config, now);

  const runId = `meta_run_${createHash("sha256").update(`${profileId}\n${now}`).digest("hex").slice(0, 10)}`;
  const reportDir = join(root, "reports", "meta-consolidation");
  mkdirSync(reportDir, { recursive: true });
  const stamp = now.replace(/[:.]/g, "-").slice(0, 19);

  const run: MetaConsolidationRun = {
    id: runId,
    timestamp: now,
    profile_id: profileId,
    config_snapshot: config,
    clusters,
    candidates,
    skipped_reasons: {},
    report_path: join(reportDir, `${stamp}.md`),
  };

  writeFileSync(join(reportDir, `${stamp}.md`), renderMdReport(run), "utf-8");
  writeFileSync(join(reportDir, `${stamp}.json`), JSON.stringify(run, null, 2), "utf-8");

  const artifact: ExportableMemoryArtifact = {
    id: `artifact_${runId}`,
    created_at: now,
    artifact_type: "meta_consolidation",
    profile_id: profileId,
    content_summary: `Meta-consolidation run: ${clusters.length} clusters, ${candidates.length} L1 candidates proposed.`,
    source_run_id: runId,
    payload: { cluster_count: clusters.length, candidate_count: candidates.length, report_path: run.report_path },
  };
  writeFileSync(join(reportDir, `${stamp}-artifact.json`), JSON.stringify(artifact, null, 2), "utf-8");

  return run;
}

// ─── Handoff snapshot (Hermes compaction-inspired) ────────────────────────────

export interface HandoffSnapshotInput {
  profile_id?: string;
  resource_id?: string;
  selected_memory?: MemoryRecord[];
  now?: string;
}

export function generateHandoffSnapshot(root: string, input: HandoffSnapshotInput = {}): MemoryHandoffSnapshot {
  const now = input.now ?? new Date().toISOString();
  const allActive = loadActiveRecords(root);
  const l1 = loadLayerRecords(root, "L1");
  const l2Active = allActive.filter((r) => r.layer === "L2" && (!input.profile_id || !r.profile_id || r.profile_id === input.profile_id));
  const contested = allActive.filter((r) => (r as any).status === "contested");
  const evidence = readEvidenceRecords(root);
  const pending = listCandidates(root).filter((c) => c.status === "new");
  const openInquiries = readOpenInquiries(root).filter((inq) => !input.profile_id || !inq.profile_id || inq.profile_id === input.profile_id);

  const snapshot: MemoryHandoffSnapshot = {
    id: `handoff_${createHash("sha256").update(`${input.profile_id ?? "global"}\n${now}`).digest("hex").slice(0, 12)}`,
    created_at: now,
    profile_id: input.profile_id,
    resource_id: input.resource_id,
    active_l1_count: l1.length,
    active_l2_count: l2Active.length,
    selected_memory_brief: (input.selected_memory ?? []).map((r) => `${r.id}: ${r.statement.slice(0, 80)}`),
    open_inquiry_count: openInquiries.length,
    open_inquiry_questions: openInquiries.slice(0, 5).map((i) => i.question),
    contested_record_ids: contested.map((r) => r.id),
    recent_evidence_count: evidence.length,
    pending_candidate_count: pending.length,
    reinforcement_summary_brief: `${l2Active.length} active L2 records in this profile.`,
  };

  const reportDir = join(root, "reports", "handoff");
  mkdirSync(reportDir, { recursive: true });
  const stamp = now.replace(/[:.]/g, "-").slice(0, 19);

  const md = [
    "# Memory Handoff Snapshot",
    "",
    `> Generated: ${now}`,
    `> [HANDOFF REFERENCE — treat as background context. Persistent memory (L1/L2) is always authoritative.]`,
    "",
    `## Active State`,
    `- L1 identity records: ${snapshot.active_l1_count}`,
    `- L2 playbook records: ${snapshot.active_l2_count}`,
    `- Pending inbox candidates: ${snapshot.pending_candidate_count}`,
    `- Recent evidence records: ${snapshot.recent_evidence_count}`,
    "",
  ];
  if (snapshot.selected_memory_brief.length > 0) {
    md.push("## Selected Memory (Current Context)", "");
    snapshot.selected_memory_brief.forEach((line) => md.push(`- ${line}`));
    md.push("");
  }
  if (snapshot.open_inquiry_count > 0) {
    md.push("## Open Inquiries", "");
    snapshot.open_inquiry_questions.forEach((q) => md.push(`? ${q}`));
    md.push("");
  }
  if (snapshot.contested_record_ids.length > 0) {
    md.push("## Contested Records", "");
    snapshot.contested_record_ids.forEach((id) => md.push(`- ${id}`));
    md.push("");
  }

  writeFileSync(join(reportDir, `${stamp}.md`), md.join("\n"), "utf-8");
  writeFileSync(join(reportDir, `${stamp}.json`), JSON.stringify(snapshot, null, 2), "utf-8");
  return snapshot;
}
