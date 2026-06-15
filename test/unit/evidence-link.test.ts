import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvidenceRecord } from "../../src/evidence";
import { linkEvidenceToCandidate } from "../../src/evidence-link";
import { listCandidates } from "../../src/inbox";
import { readOpenInquiries } from "../../src/inquiries";
import { ensureMemoryDirs } from "../../src/paths";

function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-evidence-link-")); ensureMemoryDirs(dir); return dir; }
function cleanup(dir: string): void { rmSync(dir, { recursive: true, force: true }); }

describe("evidence linking", () => {
  test("valid evidence ID creates reviewable candidate preserving evidence metadata", () => {
    const dir = root();
    try {
      const evidence = appendEvidenceRecord(dir, { id: "", resource_id: "r", profile_id: "p", created_at: "2026-06-15T00:00:00Z", source_kind: "codebase_analysis", source_summary: "bun test passed", trust_class: "passing_tool_or_test_outcome", polarity: "supports", durability_signal: "project", related_memory_ids: [], codebase_analysis: { source_kind: "codebase_analysis", tool: "vitest", analysis_kind: "test", exit_code: 0, timestamp: "2026-06-15T00:00:00Z" } });
      const result = linkEvidenceToCandidate(dir, { evidence_id: evidence.id, statement: "Always run bun test before committing.", tags: ["testing", "workflow"], confidence: 0.99, now: "2026-06-15T00:00:01Z" });
      expect(result.status).toBe("candidate_created");
      const candidates = listCandidates(dir);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].evidence_ids).toEqual([evidence.id]);
      expect(candidates[0].promotion_eligibility).toBe("review_only");
      expect(candidates[0].confidence).toBeLessThanOrEqual(0.78);
    } finally { cleanup(dir); }
  });

  test("missing and redacted evidence fail safely without durable mutation", () => {
    const dir = root();
    try {
      expect(linkEvidenceToCandidate(dir, { evidence_id: "missing", statement: "Always run tests." }).status).toBe("failed");
      const evidence = appendEvidenceRecord(dir, { id: "red", resource_id: "r", profile_id: "p", created_at: "n", source_kind: "conversation", source_summary: "deleted", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: [], redaction_status: "redacted" });
      expect(linkEvidenceToCandidate(dir, { evidence_id: evidence.id, statement: "Always run tests." }).status).toBe("failed");
      expect(listCandidates(dir)).toHaveLength(0);
    } finally { cleanup(dir); }
  });

  test("low-worth and ambiguous evidence links route away from durable candidates", () => {
    const dir = root();
    try {
      const evidence = appendEvidenceRecord(dir, { id: "ev", resource_id: "r", profile_id: "p", created_at: "n", source_kind: "conversation", source_summary: "ok", trust_class: "single_session_observation", polarity: "supports", related_memory_ids: [] });
      expect(linkEvidenceToCandidate(dir, { evidence_id: evidence.id, statement: "ok thanks" }).status).toBe("rejected");
      const ambiguous = linkEvidenceToCandidate(dir, { evidence_id: evidence.id, statement: "We should maybe always change the risky release workflow somehow." });
      expect(["inquiry_created", "rejected"]).toContain(ambiguous.status);
      expect(listCandidates(dir)).toHaveLength(0);
      expect(readOpenInquiries(dir).length).toBeGreaterThanOrEqual(ambiguous.status === "inquiry_created" ? 1 : 0);
    } finally { cleanup(dir); }
  });

  test("command output and candidate text redact secret-like input", () => {
    const dir = root();
    try {
      const evidence = appendEvidenceRecord(dir, { id: "secret-safe", resource_id: "r", profile_id: "p", created_at: "n", source_kind: "conversation", source_summary: "run tests", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: [] });
      const result = linkEvidenceToCandidate(dir, { evidence_id: evidence.id, statement: "Always run tests with OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP" });
      expect(JSON.stringify(result)).not.toContain("sk-proj-");
    } finally { cleanup(dir); }
  });
});
