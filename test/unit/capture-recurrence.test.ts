import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCandidate, listCandidates } from "../../src/inbox";
import { appendOrReinforceCandidate, normalizedPreferenceKey } from "../../src/capture-recurrence";
import type { CaptureCandidate } from "../../src/types";

const dirs: string[] = [];
function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-capture-recurrence-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

function candidate(id: string, text: string, session: string): CaptureCandidate {
  return {
    id,
    created_at: "2026-07-26T00:00:00Z",
    source: { type: "user_preference", ref: `session:${session}` },
    text,
    tags: ["preference", "writing"],
    evidence_refs: [`session:${session}`],
    confidence: 0.9,
    status: "new",
    capture_intent: "user_preference",
    scope_targets: [{ type: "global", confidence: 0.95, basis: ["explicit_user_global"] }],
    normalized_preference_key: normalizedPreferenceKey(text, "user_preference"),
    recurrence_count: 1,
    source_session_ids: [session],
    source_turn_ids: [`${session}:t1`],
    primary_trust_class: "direct_user_instruction",
  };
}

describe("capture recurrence", () => {
  test("normalizes equivalent em dash preferences", () => {
    expect(normalizedPreferenceKey("Avoid em-dashes in public writing.", "user_preference"))
      .toBe(normalizedPreferenceKey("Never use em dashes in public writing.", "user_preference"));
  });

  test("reinforces an equivalent candidate instead of appending a duplicate", () => {
    const dir = root();
    appendCandidate(dir, candidate("cap_1", "Avoid em dashes in public writing.", "s1"));
    const result = appendOrReinforceCandidate(dir, candidate("cap_2", "Never use em-dashes in public writing.", "s2"));
    expect(result.action).toBe("reinforced");
    const rows = listCandidates(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0].recurrence_count).toBe(2);
    expect(rows[0].source_session_ids).toEqual(["s1", "s2"]);
    expect(rows[0].primary_trust_class).toBe("repeated_user_preference");
  });

  test("does not merge the same wording across different project scopes", () => {
    const dir = root();
    const first = candidate("cap_1", "Run cargo test before release.", "s1");
    first.scope_targets = [{ type: "project", project: "repo-a", confidence: 0.9, basis: ["modified_project"] }];
    first.normalized_preference_key = normalizedPreferenceKey(first.text, "workflow_playbook");
    appendCandidate(dir, first);
    const second = candidate("cap_2", "Run cargo test before release.", "s2");
    second.scope_targets = [{ type: "project", project: "repo-b", confidence: 0.9, basis: ["modified_project"] }];
    second.normalized_preference_key = normalizedPreferenceKey(second.text, "workflow_playbook");
    expect(appendOrReinforceCandidate(dir, second).action).toBe("created");
    expect(listCandidates(dir)).toHaveLength(2);
  });
});
