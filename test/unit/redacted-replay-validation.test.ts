import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { runReplayFixture, validateReplayFixture, validateReplayFixturePrivacy } from "../../src/replay-fixtures";

function fixture(name: string): any { return JSON.parse(readFileSync(join(process.cwd(), "eval", "fixtures", name), "utf-8")); }
function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-redacted-replay-")); ensureMemoryDirs(dir); return dir; }

const expectedFixtures = [
  "durable-correction-survives.json",
  "temporary-instruction-not-durable.json",
  "privacy-purge-boundary.json",
  "l1-l2-playbook-relevance.json",
  "noisy-session-overcapture.json",
];

describe("redacted replay validation", () => {
  test("fixture schema requires explicit metadata and accepts committed redacted validation fixtures", () => {
    for (const name of expectedFixtures) {
      const loaded = fixture(name);
      expect(validateReplayFixture(loaded)).toBe(true);
      expect(loaded.metadata.privacy_reviewed).toBe(true);
      expect(["synthetic", "captured_style_synthetic", "redacted_real"]).toContain(loaded.metadata.fixture_kind);
    }
  });

  test("fixture privacy validation catches email, private paths, and tokens", () => {
    const unsafe = fixture("durable-correction-survives.json");
    unsafe.sessions[0].turns[0].content = "email person@example.com path /home/alice/private token OPENAI_API_KEY=abcdef1234567890";

    const findings = validateReplayFixturePrivacy(unsafe);

    expect(findings).toContain("email_like_string");
    expect(findings).toContain("absolute_private_path");
    expect(findings).toContain("token_like_secret");
  });

  test("all committed replay fixtures pass privacy validation", () => {
    for (const name of expectedFixtures) expect(validateReplayFixturePrivacy(fixture(name))).toEqual([]);
  });

  test("durable correction fixture recalls bun convention and omits npm convention", () => {
    const dir = root();
    try {
      const result = runReplayFixture(dir, fixture("durable-correction-survives.json"));
      expect(result.failures).toEqual([]);
      expect(result.expected_recall_hits).toBeGreaterThanOrEqual(1);
      expect(result.unexpected_recall_count).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("temporary instruction fixture is rejected as durable memory", () => {
    const dir = root();
    try {
      const result = runReplayFixture(dir, fixture("temporary-instruction-not-durable.json"));
      expect(result.failures).toEqual([]);
      expect(result.temporary_instruction_rejections).toBeGreaterThanOrEqual(1);
      expect(result.candidates_created).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("privacy purge fixture has zero privacy leaks after replay", () => {
    const dir = root();
    try {
      const result = runReplayFixture(dir, fixture("privacy-purge-boundary.json"));
      expect(result.failures).toEqual([]);
      expect(result.privacy_leak_count).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("L1/L2 relevance fixture recalls task playbook without L1 starvation", () => {
    const dir = root();
    try {
      const result = runReplayFixture(dir, fixture("l1-l2-playbook-relevance.json"));
      expect(result.failures).toEqual([]);
      expect(result.expected_recall_hits).toBeGreaterThanOrEqual(1);
      expect(result.context_size).toBeGreaterThan(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("noisy session fixture rejects transient noise and captures only durable convention", () => {
    const dir = root();
    try {
      const result = runReplayFixture(dir, fixture("noisy-session-overcapture.json"));
      expect(result.failures).toEqual([]);
      expect(result.noise_count).toBeLessThanOrEqual(1);
      expect(result.candidate_precision_proxy).toBeGreaterThanOrEqual(0.5);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
