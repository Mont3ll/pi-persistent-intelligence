import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { redactReplayContent, runCaptureReplayFixture, runReplayFixture, validateReplayFixture } from "../../src/replay-fixtures";

function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-replay-")); ensureMemoryDirs(dir); return dir; }
function cleanup(dir: string): void { rmSync(dir, { recursive: true, force: true }); }
function fixture(name: string): any { return JSON.parse(readFileSync(join(process.cwd(), "eval", "fixtures", name), "utf-8")); }
function captureFixture(name: string): any { return JSON.parse(readFileSync(join(process.cwd(), "test", "fixtures", "replay", "context-sensitive-capture", name), "utf-8")); }

describe("captured-style replay fixture framework", () => {
  test("fixture schema validation accepts starter fixtures", () => {
    expect(validateReplayFixture(fixture("project-convention-correction.json"))).toBe(true);
    expect(validateReplayFixture(fixture("temporary-instruction.json"))).toBe(true);
  });

  test("redaction removes secrets, private paths, emails, URLs and phones", () => {
    const redacted = redactReplayContent("Email me@example.com path /home/alice/private token OPENAI_API_KEY=abcdef1234567890 https://example.com +1 555 123 4567", { redactUrls: true });
    expect(redacted).toContain("[redacted_email]");
    expect(redacted).toContain("[redacted_path]");
    expect(redacted).toContain("[redacted_secret]");
    expect(redacted).toContain("[redacted_url]");
    expect(redacted).toContain("[redacted_phone]");
  });

  test("context-sensitive runner replays global applicability and recurrence", () => {
    const dir = root();
    try {
      const result = runCaptureReplayFixture(dir, captureFixture("avoid-em-dashes.json"));
      expect(result.failures).toEqual([]);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].scope_targets).toEqual([expect.objectContaining({ type: "global" })]);
      expect(result.candidates[0].proposed_applies_when).toContain("writing");
      expect(result.candidates[0].recurrence_count).toBe(2);
    } finally { cleanup(dir); }
  });

  test("context-sensitive runner targets modified repositories and rejects wrappers", () => {
    const scopedDir = root();
    const wrapperDir = root();
    try {
      const scoped = runCaptureReplayFixture(scopedDir, captureFixture("vault-multi-repo.json"));
      expect(scoped.failures).toEqual([]);
      expect(scoped.candidates[0].scope_targets?.map((target: any) => target.project).sort()).toEqual(["pi-governance-rs", "pi-persistent-intelligence"]);
      const wrapper = runCaptureReplayFixture(wrapperDir, captureFixture("task-wrapper.json"));
      expect(wrapper.failures).toEqual([]);
      expect(wrapper.candidates).toHaveLength(0);
    } finally { cleanup(scopedDir); cleanup(wrapperDir); }
  });

  test("runner captures convention and keeps temporary instruction non-durable", () => {
    const dir = root();
    try {
      const correction = runReplayFixture(dir, fixture("project-convention-correction.json"));
      expect(correction.failures).toEqual([]);
      expect(correction.candidates_created).toBeGreaterThan(0);
      const temp = runReplayFixture(root(), fixture("temporary-instruction.json"));
      expect(temp.rejected_observations).toBeGreaterThan(0);
    } finally { cleanup(dir); }
  });
});
