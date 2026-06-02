import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listCandidates } from "./inbox";
import { readEvidenceRecords } from "./evidence";
import { readInquiryRecords } from "./inquiries";
import { readReinforcementEvents } from "./reinforcement";
import { ensureMemoryDirs } from "./paths";
import { readDeletionTombstones } from "./tombstones";
import { loadAllRecords } from "./store";
import { redactSecretsInObject } from "./secret-scanner";

export type MemoryGraphNodeType = "memory_record" | "evidence_record" | "inquiry" | "reinforcement_event" | "tombstone" | "candidate" | "patch" | "meta_candidate";
export type MemoryGraphEdgeType = "supported_by" | "created_by" | "contradicted_by" | "qualifies" | "supersedes" | "superseded_by" | "tombstoned_by" | "blocked_by" | "related_to" | "reinforced_by" | "corrected_by" | "proposed_by" | "answered_by" | "matched_to";

export interface MemoryGraphNode {
  id: string;
  type: MemoryGraphNodeType;
  label: string;
  payload?: Record<string, unknown>;
}

export interface MemoryGraphEdge {
  id: string;
  type: MemoryGraphEdgeType;
  from: string;
  to: string;
  label?: string;
}

export interface MemoryGraphExport {
  generated_at: string;
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
}

function nodeId(type: MemoryGraphNodeType, id: string): string {
  return `${type}:${id}`;
}

function cleanPayload(value: Record<string, unknown>): Record<string, unknown> {
  return redactSecretsInObject(value) as Record<string, unknown>;
}

export function exportMemoryGraph(root: string, now = new Date().toISOString()): MemoryGraphExport {
  const nodes: MemoryGraphNode[] = [];
  const edges: MemoryGraphEdge[] = [];
  const addNode = (type: MemoryGraphNodeType, id: string, label: string, payload?: Record<string, unknown>) => nodes.push({ id: nodeId(type, id), type, label, payload: payload ? cleanPayload(payload) : undefined });
  const addEdge = (type: MemoryGraphEdgeType, from: string, to: string, label?: string) => edges.push({ id: `${type}:${from}->${to}`, type, from, to, label });

  const memories = loadAllRecords(root);
  const evidence = readEvidenceRecords(root);
  const tombstones = readDeletionTombstones(root);
  const inquiries = readInquiryRecords(root);
  const reinforcements = readReinforcementEvents(root);
  const candidates = listCandidates(root);

  for (const memory of memories) {
    addNode("memory_record", memory.id, memory.statement.slice(0, 80), { ...memory });
    for (const ev of memory.evidence) addEdge("supported_by", nodeId("memory_record", memory.id), nodeId("evidence_record", ev.ref), ev.note);
    for (const superseded of memory.supersedes ?? []) addEdge("supersedes", nodeId("memory_record", memory.id), nodeId("memory_record", superseded));
    for (const replacement of memory.superseded_by ?? []) addEdge("superseded_by", nodeId("memory_record", memory.id), nodeId("memory_record", replacement));
  }

  for (const ev of evidence) {
    addNode("evidence_record", ev.id, ev.source_summary.slice(0, 80), { ...ev });
    for (const memoryId of ev.related_memory_ids ?? []) addEdge(ev.polarity === "contradicts" ? "contradicted_by" : ev.polarity === "qualifies" ? "qualifies" : "supported_by", nodeId("memory_record", memoryId), nodeId("evidence_record", ev.id));
  }

  for (const tombstone of tombstones) {
    addNode("tombstone", tombstone.id, tombstone.deleted_record_id, { ...tombstone });
    addEdge("tombstoned_by", nodeId("memory_record", tombstone.deleted_record_id), nodeId("tombstone", tombstone.id));
  }

  for (const inquiry of inquiries) {
    addNode("inquiry", inquiry.id, inquiry.question.slice(0, 80), { ...inquiry });
    for (const memoryId of inquiry.related_memory_ids ?? []) addEdge("related_to", nodeId("inquiry", inquiry.id), nodeId("memory_record", memoryId));
    if (inquiry.answer_memory_id) addEdge("answered_by", nodeId("inquiry", inquiry.id), nodeId("memory_record", inquiry.answer_memory_id));
  }

  for (const event of reinforcements) {
    addNode("reinforcement_event", event.id, event.outcome, { ...event });
    addEdge("reinforced_by", nodeId("memory_record", event.memory_id), nodeId("reinforcement_event", event.id));
  }

  for (const candidate of candidates) {
    addNode("candidate", candidate.id, candidate.text.slice(0, 80), { ...candidate });
    for (const memoryId of candidate.matched_memory_ids ?? []) addEdge("matched_to", nodeId("candidate", candidate.id), nodeId("memory_record", memoryId));
    for (const evidenceId of candidate.evidence_ids ?? []) addEdge("supported_by", nodeId("candidate", candidate.id), nodeId("evidence_record", evidenceId));
  }

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => a.id.localeCompare(b.id));
  return redactSecretsInObject({ generated_at: now, nodes, edges }) as MemoryGraphExport;
}

export function renderMemoryGraphSummary(graph: MemoryGraphExport): string {
  const nodeCounts = new Map<string, number>();
  const edgeCounts = new Map<string, number>();
  for (const node of graph.nodes) nodeCounts.set(node.type, (nodeCounts.get(node.type) ?? 0) + 1);
  for (const edge of graph.edges) edgeCounts.set(edge.type, (edgeCounts.get(edge.type) ?? 0) + 1);
  return [
    `PI Memory Graph - ${graph.generated_at}`,
    `Nodes: ${graph.nodes.length}`,
    `Edges: ${graph.edges.length}`,
    "",
    "Node types:",
    ...[...nodeCounts.entries()].sort().map(([type, count]) => `- ${type}: ${count}`),
    "",
    "Edge types:",
    ...[...edgeCounts.entries()].sort().map(([type, count]) => `- ${type}: ${count}`),
  ].join("\n");
}

export function saveMemoryGraphReport(root: string, graph: MemoryGraphExport): string {
  const dir = join(ensureMemoryDirs(root).reports, "memory-graph");
  mkdirSync(dir, { recursive: true });
  const stamp = graph.generated_at.replace(/[:.]/g, "-").slice(0, 19);
  const path = join(dir, `${stamp}.json`);
  writeFileSync(path, `${JSON.stringify(redactSecretsInObject(graph), null, 2)}\n`, "utf-8");
  return path;
}
