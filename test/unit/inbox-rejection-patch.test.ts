import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInboxRejectionPatch } from "../../src/inbox-rejection";
import { appendCandidate, listCandidates } from "../../src/inbox";
import { applyPatch } from "../../src/patch";
import type { CaptureCandidate } from "../../src/types";

let roots: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-inbox-rejection-"));
  roots.push(dir);
  return dir;
}

function candidate(id: string, confidence: number, evidence_refs: string[]): CaptureCandidate {
  return {
    id,
    created_at: "2026-09-29T00:00:00Z",
    source: { type: "manual", ref: "test" },
    text: `Candidate ${id}`,
    tags: ["test"],
    evidence_refs,
    confidence,
    status: "new",
  };
}

afterEach(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  roots = [];
});

describe("Inbox rejection patch", () => {
  test("offers every new candidate for governed selective rejection regardless of curation eligibility", () => {
    const dir = root();
    const lowQuality = candidate("cap_low", 0.2, []);
    const ordinary = candidate("cap_ordinary", 0.9, ["ev1", "ev2"]);
    appendCandidate(dir, lowQuality);
    appendCandidate(dir, ordinary);

    const rejection = buildInboxRejectionPatch([lowQuality, ordinary], "2026-09-29T00:01:00Z");
    expect(rejection.ops).toEqual([
      expect.objectContaining({ op: "reject_candidate", candidate_id: "cap_low", risk: "low", default_selected: false }),
      expect.objectContaining({ op: "reject_candidate", candidate_id: "cap_ordinary", risk: "low", default_selected: false }),
    ]);

    const selected = rejection.ops.find((op) => op.candidate_id === "cap_low")!;
    applyPatch(dir, rejection, { selectedOpIds: [selected.op_id], now: "2026-09-29T00:02:00Z" });

    expect(listCandidates(dir).find((item) => item.id === "cap_low")?.status).toBe("rejected");
    expect(listCandidates(dir).find((item) => item.id === "cap_ordinary")?.status).toBe("new");
  });
});
