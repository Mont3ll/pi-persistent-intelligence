import { readEvidenceRecords } from "./evidence";
import { exportMemoryGraph, type MemoryGraphEdge, type MemoryGraphEdgeType, type MemoryGraphExport } from "./memory-graph";
import { redactSecrets, redactSecretsInObject } from "./secret-scanner";
import { loadAllRecords } from "./store";
import type { EvidenceRecord, MemoryRecord } from "./types";

export type RelationshipQualityBand = "strong" | "medium" | "weak" | "broken";

export interface RelationshipQualityEdgeItem {
  edge_id: string;
  type: MemoryGraphEdgeType;
  from: string;
  to: string;
  quality_score: number;
  quality_band: RelationshipQualityBand;
  signals: string[];
  reasons: string[];
  mutation_performed: false;
}

export interface RelationshipQualityMemoryNode {
  memory_id: string;
  degree: number;
  live_evidence_edges: number;
  weak_edges: number;
  contradiction_edges: number;
  supersession_edges: number;
  reinforcement_edges: number;
  signals: string[];
  reasons: string[];
  mutation_performed: false;
}

export interface RelationshipQualityRecommendation {
  id: string;
  summary: string;
  reason: string;
  affected_ids: string[];
  review_required: true;
  mutation_performed: false;
}

export interface RelationshipQualityReport {
  generated_at: string;
  summary: {
    total_edges: number;
    weak_edge_count: number;
    dangling_edge_count: number;
    orphan_memory_count: number;
    dead_end_memory_count: number;
    high_value_hub_count: number;
    cyclic_memory_pair_count: number;
    average_relationship_quality: number;
  };
  relationships: RelationshipQualityEdgeItem[];
  memory_nodes: RelationshipQualityMemoryNode[];
  recommendations: RelationshipQualityRecommendation[];
  mutation_performed: false;
}

export interface AnalyzeRelationshipQualityOptions { now?: string; }

type EvidenceStatus = "live" | "redacted_or_deleted" | "missing";

function bandFor(score: number): RelationshipQualityBand {
  if (score <= 0) return "broken";
  if (score < 50) return "weak";
  if (score < 80) return "medium";
  return "strong";
}

function memoryIdFromNode(nodeId: string): string | null {
  return nodeId.startsWith("memory_record:") ? nodeId.slice("memory_record:".length) : null;
}

function evidenceIdFromNode(nodeId: string): string | null {
  return nodeId.startsWith("evidence_record:") ? nodeId.slice("evidence_record:".length) : null;
}

function edgeTouchesMemory(edge: Pick<MemoryGraphEdge, "from" | "to">, memoryId: string): boolean {
  return edge.from === `memory_record:${memoryId}` || edge.to === `memory_record:${memoryId}`;
}

function evidenceStatus(edge: MemoryGraphEdge, evidenceById: Map<string, { redaction_status?: string }>): EvidenceStatus | null {
  const id = evidenceIdFromNode(edge.from) ?? evidenceIdFromNode(edge.to);
  if (!id) return null;
  const ev = evidenceById.get(id);
  if (!ev) return "missing";
  return ev.redaction_status === "deleted" || ev.redaction_status === "redacted" ? "redacted_or_deleted" : "live";
}

function scoreEdge(edge: MemoryGraphEdge, nodeIds: Set<string>, evidenceById: Map<string, { redaction_status?: string }>): RelationshipQualityEdgeItem {
  const signals: string[] = [];
  const reasons: string[] = [];
  let score = 70;

  if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
    score = 0;
    signals.push("dangling_endpoint");
    reasons.push("edge references a node that is not present in the exported memory graph");
  }

  const evStatus = evidenceStatus(edge, evidenceById);
  if (evStatus === "live" && edge.type === "supported_by") {
    score = Math.max(score, 90);
    signals.push("live_supporting_evidence");
    reasons.push("relationship is backed by live structured evidence");
  } else if (evStatus === "redacted_or_deleted") {
    score = Math.min(score, 35);
    signals.push("redacted_or_deleted_evidence");
    reasons.push("relationship depends on redacted or deleted evidence");
  } else if (evStatus === "missing") {
    score = Math.min(score, 20);
    signals.push("missing_evidence_node");
    reasons.push("relationship references evidence that is not present in the evidence store");
  }

  if (edge.type === "contradicted_by") {
    score = Math.min(score, 30);
    signals.push("contradiction_edge");
    reasons.push("relationship records contradictory evidence and requires review");
  } else if (edge.type === "qualifies") {
    score = Math.min(score, 65);
    signals.push("qualifying_edge");
    reasons.push("relationship qualifies rather than directly supports the memory");
  } else if (edge.type === "supersedes" || edge.type === "superseded_by") {
    score = Math.max(score, 85);
    signals.push("supersession_edge");
    reasons.push("relationship is an explicit lifecycle transition between memories");
  } else if (edge.type === "reinforced_by") {
    score = Math.max(score, 82);
    signals.push("reinforcement_edge");
    reasons.push("relationship is supported by a reinforcement event");
  }

  if (!reasons.length) reasons.push("relationship has no obvious structural weakness");

  return {
    edge_id: edge.id,
    type: edge.type,
    from: edge.from,
    to: edge.to,
    quality_score: Math.max(0, Math.min(100, Math.round(score))),
    quality_band: bandFor(score),
    signals,
    reasons,
    mutation_performed: false,
  };
}

function reciprocalMemoryPairKey(edge: MemoryGraphEdge): string | null {
  const from = memoryIdFromNode(edge.from);
  const to = memoryIdFromNode(edge.to);
  if (!from || !to) return null;
  if (edge.type === "supersedes" || edge.type === "superseded_by") return null;
  return [from, to].sort().join("<->");
}

function addEdgeForMemory<T extends Pick<MemoryGraphEdge, "from" | "to">>(map: Map<string, T[]>, edge: T): void {
  for (const memoryId of [memoryIdFromNode(edge.from), memoryIdFromNode(edge.to)].filter(Boolean) as string[]) {
    map.set(memoryId, [...(map.get(memoryId) ?? []), edge]);
  }
}

function nodeItem(record: MemoryRecord, touching: RelationshipQualityEdgeItem[], hasRawGraphEdges: boolean): RelationshipQualityMemoryNode {
  const id = record.id;
  const liveEvidenceEdges = touching.filter((edge) => edge.signals.includes("live_supporting_evidence")).length;
  const weakEdges = touching.filter((edge) => edge.quality_band === "weak" || edge.quality_band === "broken").length;
  const contradictionEdges = touching.filter((edge) => edge.type === "contradicted_by").length;
  const supersessionEdges = touching.filter((edge) => edge.type === "supersedes" || edge.type === "superseded_by").length;
  const reinforcementEdges = touching.filter((edge) => edge.type === "reinforced_by").length;
  const relationTypes = new Set(touching.map((edge) => edge.type));
  const nonEvidenceEdges = touching.filter((edge) => !edge.from.startsWith("evidence_record:") && !edge.to.startsWith("evidence_record:"));
  const signals: string[] = [];
  const reasons: string[] = [];

  if (liveEvidenceEdges === 0 && nonEvidenceEdges.length === 0 && contradictionEdges === 0) {
    signals.push("orphan_memory");
    reasons.push("memory has no live evidence, contradiction review context, or non-evidence graph relationships");
  }
  if (hasRawGraphEdges && liveEvidenceEdges === 0 && reinforcementEdges === 0 && supersessionEdges === 0) {
    signals.push("dead_end_memory");
    reasons.push("memory has graph edges but no live evidence, reinforcement, or lifecycle relationship");
  }
  if (touching.length >= 4 && relationTypes.size >= 2 && contradictionEdges === 0) {
    signals.push("high_value_hub");
    reasons.push("memory connects multiple relationship types without contradiction signals");
  }
  if (weakEdges > 0) {
    signals.push("weak_relationships");
    reasons.push(`${weakEdges} weak or broken relationship(s) touch this memory`);
  }
  if (contradictionEdges > 0) reasons.push(`${contradictionEdges} contradiction relationship(s) touch this memory`);
  if (!reasons.length) reasons.push("memory relationships appear structurally healthy");

  return {
    memory_id: id,
    degree: touching.length,
    live_evidence_edges: liveEvidenceEdges,
    weak_edges: weakEdges,
    contradiction_edges: contradictionEdges,
    supersession_edges: supersessionEdges,
    reinforcement_edges: reinforcementEdges,
    signals: [...new Set(signals)],
    reasons,
    mutation_performed: false,
  };
}

function recommendationsFor(edges: RelationshipQualityEdgeItem[], nodes: RelationshipQualityMemoryNode[], cyclicPairCount: number): RelationshipQualityRecommendation[] {
  const recs: RelationshipQualityRecommendation[] = [];
  const weakEdges = edges.filter((edge) => edge.quality_band === "weak" || edge.quality_band === "broken");
  if (weakEdges.length) recs.push({ id: "rq_weak_edges", summary: "Review weak memory relationships", reason: `${weakEdges.length} relationship edge(s) are weak or broken.`, affected_ids: weakEdges.map((edge) => edge.edge_id), review_required: true, mutation_performed: false });
  const orphans = nodes.filter((node) => node.signals.includes("orphan_memory"));
  if (orphans.length) recs.push({ id: "rq_orphan_memories", summary: "Review orphan memories", reason: `${orphans.length} memory record(s) have no evidence or graph relationships.`, affected_ids: orphans.map((node) => node.memory_id), review_required: true, mutation_performed: false });
  const deadEnds = nodes.filter((node) => node.signals.includes("dead_end_memory"));
  if (deadEnds.length) recs.push({ id: "rq_dead_end_memories", summary: "Review dead-end memories", reason: `${deadEnds.length} memory record(s) have relationships that do not connect to live evidence, reinforcement, or lifecycle context.`, affected_ids: deadEnds.map((node) => node.memory_id), review_required: true, mutation_performed: false });
  if (cyclicPairCount > 0) recs.push({ id: "rq_cyclic_memory_pairs", summary: "Review cyclic memory relationships", reason: `${cyclicPairCount} reciprocal memory pair(s) may need lifecycle review.`, affected_ids: [], review_required: true, mutation_performed: false });
  return recs;
}

export function analyzeRelationshipQualityFromGraph(input: { generated_at: string; graph: MemoryGraphExport; records: MemoryRecord[]; evidence: EvidenceRecord[] }): RelationshipQualityReport {
  const { generated_at: now, graph, records, evidence } = input;
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const evidenceById = new Map(evidence.map((ev) => [ev.id, ev]));
  const relationships = graph.edges.map((edge) => scoreEdge(edge, nodeIds, evidenceById)).sort((a, b) => a.quality_score - b.quality_score || a.edge_id.localeCompare(b.edge_id));
  const relationshipEdgesByMemory = new Map<string, RelationshipQualityEdgeItem[]>();
  const rawEdgesByMemory = new Map<string, MemoryGraphEdge[]>();
  for (const edge of relationships) addEdgeForMemory(relationshipEdgesByMemory, edge);
  for (const edge of graph.edges) addEdgeForMemory(rawEdgesByMemory, edge);
  const memoryNodes = records.map((record) => nodeItem(record, relationshipEdgesByMemory.get(record.id) ?? [], (rawEdgesByMemory.get(record.id) ?? []).length > 0)).sort((a, b) => b.weak_edges - a.weak_edges || a.memory_id.localeCompare(b.memory_id));
  const reciprocalPairs = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const key = reciprocalMemoryPairKey(edge);
    if (!key) continue;
    reciprocalPairs.set(key, new Set([...(reciprocalPairs.get(key) ?? new Set<string>()), `${edge.type}:${edge.from}->${edge.to}`]));
  }
  const cyclicPairCount = [...reciprocalPairs.values()].filter((directions) => directions.size > 1).length;
  const avg = relationships.length ? Math.round(relationships.reduce((sum, edge) => sum + edge.quality_score, 0) / relationships.length) : 100;

  return redactSecretsInObject({
    generated_at: now,
    summary: {
      total_edges: relationships.length,
      weak_edge_count: relationships.filter((edge) => edge.quality_band === "weak" || edge.quality_band === "broken").length,
      dangling_edge_count: relationships.filter((edge) => edge.signals.includes("dangling_endpoint")).length,
      orphan_memory_count: memoryNodes.filter((node) => node.signals.includes("orphan_memory")).length,
      dead_end_memory_count: memoryNodes.filter((node) => node.signals.includes("dead_end_memory")).length,
      high_value_hub_count: memoryNodes.filter((node) => node.signals.includes("high_value_hub")).length,
      cyclic_memory_pair_count: cyclicPairCount,
      average_relationship_quality: avg,
    },
    relationships,
    memory_nodes: memoryNodes,
    recommendations: recommendationsFor(relationships, memoryNodes, cyclicPairCount),
    mutation_performed: false,
  }) as RelationshipQualityReport;
}

export function analyzeRelationshipQuality(root: string, options: AnalyzeRelationshipQualityOptions = {}): RelationshipQualityReport {
  const now = options.now ?? new Date().toISOString();
  return analyzeRelationshipQualityFromGraph({
    generated_at: now,
    graph: exportMemoryGraph(root, now),
    records: loadAllRecords(root),
    evidence: readEvidenceRecords(root),
  });
}

export function renderRelationshipQualityReport(report: RelationshipQualityReport): string {
  return redactSecrets([
    "# PI Relationship Quality Report",
    "",
    `Generated: ${report.generated_at}`,
    `Average relationship quality: ${report.summary.average_relationship_quality}/100`,
    `Edges: ${report.summary.total_edges} · Weak: ${report.summary.weak_edge_count} · Orphans: ${report.summary.orphan_memory_count} · Dead ends: ${report.summary.dead_end_memory_count} · Hubs: ${report.summary.high_value_hub_count}`,
    "",
    "## Weakest Relationships",
    ...(report.relationships.slice(0, 20).map((edge) => `- ${edge.edge_id}: ${edge.quality_score}/100 [${edge.quality_band}] ${edge.signals.join(", ") || "healthy"}`)),
    "",
    "## Memory Node Signals",
    ...(report.memory_nodes.filter((node) => node.signals.length).slice(0, 20).map((node) => `- ${node.memory_id}: degree ${node.degree}; ${node.signals.join(", ")} — ${node.reasons.join("; ")}`) || ["- No memory node relationship signals."]),
    "",
    "## Recommendations",
    ...(report.recommendations.length ? report.recommendations.map((rec) => `- ${rec.summary}: ${rec.reason} Review required; No automatic mutation performed.`) : ["- No review recommendations. No automatic mutation performed."]),
  ].join("\n"));
}
