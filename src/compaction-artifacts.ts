import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureMemoryDirs } from "./paths";
import { redactSecrets, redactSecretsInObject } from "./secret-scanner";

export type CompressionMethod = "summary" | "extractive" | "structured" | "mixed";

export interface CompactionArtifact {
  compaction_id: string;
  compacted_text: string;
  source_session_ids: string[];
  source_memory_ids: string[];
  source_evidence_ids: string[];
  original_digest: string;
  compression_method: CompressionMethod;
  reversible: boolean;
  retrieval_hint?: string;
  created_at: string;
}

export interface CreateCompactionArtifactInput {
  compacted_text: string;
  original_source_text?: string;
  source_session_ids?: string[];
  source_memory_ids?: string[];
  source_evidence_ids?: string[];
  compression_method?: CompressionMethod;
  retrieval_hint?: string;
  created_at?: string;
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function compactionArtifactsDir(root: string): string {
  const dir = join(ensureMemoryDirs(root).runtime.dir, "compaction-artifacts");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function createCompactionArtifact(input: CreateCompactionArtifactInput): CompactionArtifact {
  const created = input.created_at ?? new Date().toISOString();
  const sourceBundle = JSON.stringify({
    text: input.original_source_text ?? input.compacted_text,
    sessions: input.source_session_ids ?? [],
    memories: input.source_memory_ids ?? [],
    evidence: input.source_evidence_ids ?? [],
  });
  const hasTrace = Boolean((input.source_session_ids?.length ?? 0) || (input.source_memory_ids?.length ?? 0) || (input.source_evidence_ids?.length ?? 0));
  return redactSecretsInObject({
    compaction_id: `compact_${sha256(`${created}\n${sourceBundle}`).slice(0, 16)}`,
    compacted_text: redactSecrets(input.compacted_text),
    source_session_ids: input.source_session_ids ?? [],
    source_memory_ids: input.source_memory_ids ?? [],
    source_evidence_ids: input.source_evidence_ids ?? [],
    original_digest: sha256(sourceBundle).slice(0, 32),
    compression_method: input.compression_method ?? "summary",
    reversible: hasTrace,
    retrieval_hint: input.retrieval_hint ? redactSecrets(input.retrieval_hint) : undefined,
    created_at: created,
  }) as CompactionArtifact;
}

export function saveCompactionArtifact(root: string, artifact: CompactionArtifact): string {
  const path = join(compactionArtifactsDir(root), `${artifact.compaction_id}.json`);
  writeFileSync(path, `${JSON.stringify(redactSecretsInObject(artifact), null, 2)}\n`, "utf-8");
  return path;
}

export function readCompactionArtifacts(root: string): CompactionArtifact[] {
  const dir = compactionArtifactsDir(root);
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try { return JSON.parse(readFileSync(join(dir, name), "utf-8")) as CompactionArtifact; } catch { return null; }
      })
      .filter((item): item is CompactionArtifact => Boolean(item));
  } catch { return []; }
}

export function markCompactionArtifactNonReversible(root: string, compactionId: string, reason = "source privacy-purged"): boolean {
  const path = join(compactionArtifactsDir(root), `${compactionId}.json`);
  if (!existsSync(path)) return false;
  const artifact = JSON.parse(readFileSync(path, "utf-8")) as CompactionArtifact;
  writeFileSync(path, `${JSON.stringify({ ...artifact, reversible: false, retrieval_hint: reason }, null, 2)}\n`, "utf-8");
  return true;
}
