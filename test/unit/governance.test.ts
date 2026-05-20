import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { appendCandidate } from "../../src/inbox";
import { curateInbox } from "../../src/curator";
import { buildCandidateTrustMetadata, isAutoApplyEligibleCandidate } from "../../src/trust";
import { loadConfig } from "../../src/config";
import type { CaptureCandidate } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-gov-")); dirs.push(dir); ensureMemoryDirs(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

function candidate(overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id: "cap_test",
    created_at: "2026-05-19T10:00:00.000Z",
    source: { type: "manual", ref: "daily" },
    text: "Use bun for tests.",
    tags: ["testing"],
    evidence_refs: ["daily", "spec.md"],
    confidence: 0.9,
    status: "new",
    ...overrides,
  };
}

describe("strict governance mode", () => {
  test("legacy candidate auto-eligible in compatibility mode (default)", () => {
    expect(isAutoApplyEligibleCandidate(candidate(), "compatibility")).toBe(true);
  });

  test("legacy candidate without trust metadata blocked in strict mode", () => {
    expect(isAutoApplyEligibleCandidate(candidate(), "strict")).toBe(false);
  });

  test("legacy candidate without verification metadata blocked in strict mode", () => {
    const withTrust = candidate({
      ...buildCandidateTrustMetadata("direct_user_instruction", "project"),
    });
    delete (withTrust as any).verification_status;
    expect(isAutoApplyEligibleCandidate(withTrust, "strict")).toBe(false);
  });

  test("classified direct user instruction with verification passes strict mode", () => {
    const full = candidate({
      ...buildCandidateTrustMetadata("direct_user_instruction", "project"),
      verification_status: "verified",
      evidence_ids: ["ev_1"],
    });
    expect(isAutoApplyEligibleCandidate(full, "strict")).toBe(true);
  });

  test("low-trust candidate blocked in both compatibility and strict modes", () => {
    const lowTrust = candidate({
      ...buildCandidateTrustMetadata("repository_text", "project"),
      verification_status: "review_required",
      evidence_ids: ["ev_1"],
    });
    expect(isAutoApplyEligibleCandidate(lowTrust, "compatibility")).toBe(false);
    expect(isAutoApplyEligibleCandidate(lowTrust, "strict")).toBe(false);
  });

  test("config resolves governance mode from config.json", () => {
    const dir = root();
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ governance: { mode: "strict" } }), "utf-8");
    const cfg = loadConfig(dir);
    expect(cfg.governance.mode).toBe("strict");
  });

  test("strict mode blocks legacy candidate default_selected in curator patch", () => {
    const dir = root();
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ governance: { mode: "strict" } }), "utf-8");
    appendCandidate(dir, candidate());
    const cfg = loadConfig(dir);
    const patch = curateInbox(dir, { now: new Date().toISOString(), mode: "auto", governanceMode: cfg.governance.mode });
    expect(patch.ops.every((op) => !op.default_selected)).toBe(true);
  });

  test("compatibility mode keeps legacy default_selected behavior", () => {
    const dir = root();
    appendCandidate(dir, candidate());
    const patch = curateInbox(dir, { now: new Date().toISOString(), mode: "auto" });
    expect(patch.ops.some((op) => op.default_selected)).toBe(true);
  });
});
