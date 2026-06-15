import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompactionArtifact, markCompactionArtifactNonReversible, readCompactionArtifacts, saveCompactionArtifact } from "../../src/compaction-artifacts";
import { runContextCompactionConsolidation } from "../../src/context-compaction";
import { readEvidenceRecords } from "../../src/evidence";
import { listCandidates } from "../../src/inbox";
import { runMemoryDiagnostics } from "../../src/diagnostics";
import { ensureMemoryDirs } from "../../src/paths";

function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-compaction-")); ensureMemoryDirs(dir); return dir; }
function cleanup(dir: string): void { rmSync(dir, { recursive: true, force: true }); }

describe("reversible compaction artifacts", () => {
  test("artifact includes source IDs, digest, method, and reversible flag", () => {
    const a = createCompactionArtifact({ compacted_text: "summary", original_source_text: "original", source_session_ids: ["s1"], source_memory_ids: ["m1"], source_evidence_ids: ["e1"], compression_method: "structured", created_at: "2026-06-15T00:00:00Z" });
    const b = createCompactionArtifact({ compacted_text: "summary", original_source_text: "changed", source_session_ids: ["s1"], created_at: "2026-06-15T00:00:00Z" });
    expect(a.reversible).toBe(true);
    expect(a.original_digest).not.toBe(b.original_digest);
    expect(a.compression_method).toBe("structured");
  });

  test("context compaction creates artifact and preserves source evidence path", () => {
    const dir = root();
    try {
      const result = runContextCompactionConsolidation(dir, { resource_id: "r", profile_id: "p", thread_id: "session-1", now: "2026-06-15T00:00:00Z", observations: [{ text: "Always run bun test before commit.", tags: ["testing", "workflow"], trust_class: "direct_user_instruction", durability_signal: "project" }] });
      expect(result.compaction_artifacts_created).toBe(1);
      expect(readCompactionArtifacts(dir)[0].source_session_ids).toEqual(["session-1"]);
      expect(readEvidenceRecords(dir)[0].notes).toContain("compaction_id=");
      expect(listCandidates(dir)[0].worth_reasons?.some((reason) => reason.startsWith("compaction_id:"))).toBe(true);
    } finally { cleanup(dir); }
  });

  test("privacy purge marker makes artifact non-reversible and diagnostics warn", () => {
    const dir = root();
    try {
      const artifact = createCompactionArtifact({ compacted_text: "summary", source_session_ids: ["s1"] });
      saveCompactionArtifact(dir, artifact);
      expect(markCompactionArtifactNonReversible(dir, artifact.compaction_id)).toBe(true);
      const diagnostics = runMemoryDiagnostics(dir);
      expect(diagnostics.findings.some((finding) => finding.code === "compaction_not_reversible" && finding.severity === "warning")).toBe(true);
    } finally { cleanup(dir); }
  });
});
