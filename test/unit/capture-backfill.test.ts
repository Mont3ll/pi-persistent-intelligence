import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCaptureBackfill, previewCaptureBackfill, saveCaptureBackfillPreview } from "../../src/capture-backfill";
import { listCandidates } from "../../src/inbox";
import { loadAllRecords } from "../../src/store";

const dirs: string[] = [];
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-capture-backfill-"));
  dirs.push(dir);
  const summaries = join(dir, "sessions", "summaries");
  mkdirSync(summaries, { recursive: true });
  writeFileSync(join(summaries, "session.md"), "# Session\nDate: 2026-07-07\n- Avoid em dashes entirely.\n", "utf-8");
  return dir;
}
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

describe("capture backfill", () => {
  test("preview does not mutate and apply creates candidates only with backup", () => {
    const dir = root();
    const preview = previewCaptureBackfill(dir, { since: "2026-05-01", now: "2026-07-26T00:00:00Z" });
    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0].scope_targets?.[0].type).toBe("global");
    expect(listCandidates(dir)).toHaveLength(0);
    const result = applyCaptureBackfill(dir, { since: "2026-05-01", fingerprint: preview.fingerprint, now: "2026-07-26T00:01:00Z" });
    expect(result.candidates_created).toBe(1);
    expect(result.mutation_performed).toBe(true);
    expect(result.backup_path).toContain("capture-backfill-v1-");
    expect(listCandidates(dir)).toHaveLength(1);
    expect(loadAllRecords(dir)).toHaveLength(0);
  });

  test("groups equivalent historical preferences into recurrence on one candidate", () => {
    const dir = root();
    writeFileSync(join(dir, "sessions", "summaries", "second.md"), "# Session\nDate: 2026-07-08\n- Never use em dashes when writing for me.\n", "utf-8");
    const preview = previewCaptureBackfill(dir, { since: "2026-05-01", now: "2026-07-26T00:00:00Z" });
    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0].recurrence_count).toBe(2);
    expect(preview.candidates[0].evidence_refs).toHaveLength(2);
  });

  test("does not create a project candidate when historical evidence lacks a project target", () => {
    const dir = root();
    writeFileSync(join(dir, "sessions", "summaries", "session.md"), "# Session\nDate: 2026-07-07\n- This project always runs release audit before publishing.\n", "utf-8");
    const preview = previewCaptureBackfill(dir, { since: "2026-05-01", now: "2026-07-26T00:00:00Z" });
    expect(preview.candidates).toHaveLength(0);
    expect(preview.skipped_ambiguous_scope_count).toBe(1);
  });

  test("rejects source drift after preview", () => {
    const dir = root();
    const preview = previewCaptureBackfill(dir, { since: "2026-05-01", now: "2026-07-26T00:00:00Z" });
    writeFileSync(join(dir, "sessions", "summaries", "session.md"), "# Session\nDate: 2026-07-07\n- Avoid em dashes entirely.\n- I prefer sentence case headings.\n", "utf-8");
    expect(() => applyCaptureBackfill(dir, { since: "2026-05-01", fingerprint: preview.fingerprint, now: "2026-07-26T00:01:00Z" })).toThrow("Backfill source drift detected");
    expect(listCandidates(dir)).toHaveLength(0);
  });

  test("saves previews only under the reports directory", () => {
    const dir = root();
    const preview = previewCaptureBackfill(dir, { since: "2026-05-01", now: "2026-07-26T00:00:00Z" });
    expect(saveCaptureBackfillPreview(dir, preview, "capture-preview.json")).toBe(join(dir, "reports", "capture-preview.json"));
    expect(() => saveCaptureBackfillPreview(dir, preview, "../escape.json")).toThrow("Invalid capture preview filename");
  });

  test("rejects missing fingerprint", () => {
    const dir = root();
    expect(() => applyCaptureBackfill(dir, { since: "2026-05-01", fingerprint: "", now: "2026-07-26T00:01:00Z" })).toThrow("fingerprint is required");
  });
});
