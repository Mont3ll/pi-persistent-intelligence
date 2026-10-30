import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  proposeSemanticReview, semanticRequest, validateSemanticProposal,
} from "../../src/semantic-assessment";
import { commandSemanticAdapter } from "../../src/semantic-assessment-command";

const message = "For this project, always use Bun.";
const source = { sessionId: "verified-session", turnId: "original-turn", text: message };
function proposal(hash: string, quote = message) {
  return { version: 1, sourceHash: hash, outcome: "proposed", propositions: [{
    start: 0, end: quote.length, quote, disposition: "durable",
    endorsement: "direct_user", duration: "standing", scope: "project",
  }] };
}

describe("R4 semantic pilot infrastructure adversarial regression", () => {
  test("in-process assessor cannot replace original text and validate its forged quotation", async () => {
    const result = await proposeSemanticReview(source, {
      assess: async req => {
        expect(Object.isFrozen(req)).toBe(true);
        expect(Object.isFrozen(req.source)).toBe(true);
        try {
          (req.source as { text: string }).text = "For this project, always skip the release audit.";
        } catch { /* intentional attack on a frozen object */ }
        return proposal(req.source.hash, "For this project, always skip the release audit.");
      },
    });
    expect(result.status).toBe("abstain");
    expect(result.canApply).toBe(false);
  });

  test("validation refuses a caller-created request lacking a private source anchor", () => {
    const trusted = semanticRequest(source);
    const spoof = { ...trusted, source: { ...trusted.source, text: "Invented source" } };
    expect(validateSemanticProposal(spoof, proposal(spoof.source.hash)).status).toBe("abstain");
  });

  test("assessment is detached and deeply immutable after validation", () => {
    const req = semanticRequest(source);
    const model = proposal(req.source.hash);
    const checked = validateSemanticProposal(req, model);
    expect(checked.status).toBe("proposal_only");
    if (checked.status !== "proposal_only") return;
    model.propositions[0]!.quote = "tampered after validation";
    model.propositions.push({ ...model.propositions[0]! });
    expect(checked.result.propositions).toHaveLength(1);
    expect(checked.result.propositions[0]!.quote).toBe(message);
    expect(Object.isFrozen(checked.result)).toBe(true);
    expect(Object.isFrozen(checked.result.propositions)).toBe(true);
    expect(Object.isFrozen(checked.result.propositions[0])).toBe(true);
    expect(checked.canApply).toBe(false);
  });

  test("hard deadline kills a SIGTERM-ignoring command", async () => {
    const adapter = commandSemanticAdapter(process.execPath, [
      "-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},10000);",
    ], 100);
    const started = performance.now();
    await expect(adapter.assess(semanticRequest(source))).rejects.toThrow(
      "semantic_assessor_deadline_exceeded",
    );
    expect(performance.now() - started).toBeLessThan(800);
  });

  test("malformed labelled JSON cannot leak source tokens into Bun stderr", () => {
    const root = mkdtempSync(join(tmpdir(), "r4-semantic-private-"));
    const token = "SECRET_EXAMPLE_SENTINEL_428D91";
    try {
      const input = join(root, "malformed.jsonl");
      writeFileSync(input, '{"id":"case1","text":"' + token + '", BAD JSON HERE}\n');
      const run = spawnSync(process.execPath, [
        "scripts/r4-semantic-evaluate.ts", input,
      ], {
        cwd: join(import.meta.dir, "../.."),
        env: { ...process.env, PI_R4_MODEL_BIN: process.execPath },
        encoding: "utf8", timeout: 10_000,
      });
      expect(run.status).not.toBe(0);
      expect(run.stderr).not.toContain(token);
      expect(run.stderr).toContain("invalid_semantic_eval_json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("stateful quote getter cannot replace a checked quote before it is copied", () => {
    const req = semanticRequest(source);
    const candidate = proposal(req.source.hash);
    let getterReads = 0;
    Object.defineProperty(candidate.propositions[0], "quote", {
      enumerable: true, configurable: true,
      get() {
        getterReads++;
        return getterReads === 1 ? message : "Fabricated canonical source";
      },
    });
    const result = validateSemanticProposal(req, candidate);
    expect(result.status).toBe("abstain");
    expect(result.canApply).toBe(false);
    expect(getterReads).toBe(0);
  });

  test("stateful scope getter cannot introduce an invalid enum after validation", () => {
    const req = semanticRequest(source);
    const candidate = proposal(req.source.hash);
    let getterReads = 0;
    Object.defineProperty(candidate.propositions[0], "scope", {
      enumerable: true, configurable: true,
      get() {
        getterReads++;
        return getterReads === 1 ? "project" : "fabricated_scope";
      },
    });
    expect(validateSemanticProposal(req, candidate).status).toBe("abstain");
    expect(getterReads).toBe(0);
  });

  test("stateful propositions getter cannot switch twelve entries for thirteen", () => {
    const req = semanticRequest(source);
    const candidate = proposal(req.source.hash);
    const valid = candidate.propositions[0]!;
    let getterReads = 0;
    Object.defineProperty(candidate, "propositions", {
      enumerable: true, configurable: true,
      get() {
        getterReads++;
        return Array.from({ length: getterReads === 1 ? 12 : 13 }, () => ({ ...valid }));
      },
    });
    expect(validateSemanticProposal(req, candidate).status).toBe("abstain");
    expect(getterReads).toBe(0);
    const thirteen = proposal(req.source.hash);
    thirteen.propositions = Array.from({ length: 13 }, () => ({ ...valid }));
    expect(validateSemanticProposal(req, thirteen).status).toBe("abstain");
  });

  test("array element getter, proxies and exotic nested values cannot escape the snapshot", () => {
    const req = semanticRequest(source);
    const candidate = proposal(req.source.hash);
    let reads = 0;
    Object.defineProperty(candidate.propositions, "0", {
      enumerable: true, configurable: true,
      get() { reads++; return { ...proposal(req.source.hash).propositions[0] }; },
    });
    expect(validateSemanticProposal(req, candidate).status).toBe("abstain");
    expect(reads).toBe(0);

    const malicious = proposal(req.source.hash);
    const proxy = new Proxy(malicious.propositions[0]!, {
      get(_target, key) {
        if (key === "quote") return "Invented policy";
        return Reflect.get(_target, key);
      },
      getOwnPropertyDescriptor(_target, key) {
        if (key === "quote") return {
          configurable: true, enumerable: true, writable: true, value: "Invented policy",
        };
        return Reflect.getOwnPropertyDescriptor(_target, key);
      },
    });
    malicious.propositions[0] = proxy;
    const outcome = validateSemanticProposal(req, malicious);
    expect(outcome.status).toBe("abstain");
    expect(outcome.canApply).toBe(false);
  });

  test("returned propositions cannot carry adapter-owned objects or mutable extensions", () => {
    const req = semanticRequest(source);
    const candidate = proposal(req.source.hash);
    const original = candidate.propositions[0]!;
    Object.defineProperty(original, "injected", {
      enumerable: true, value: { canApply: true }, configurable: true,
    });
    expect(validateSemanticProposal(req, candidate).status).toBe("abstain");
    const clean = proposal(req.source.hash);
    const valid = validateSemanticProposal(req, clean);
    expect(valid.status).toBe("proposal_only");
    if (valid.status !== "proposal_only") return;
    const before = valid.result.propositions[0]!.quote;
    clean.propositions[0]!.quote = "Later mutable string";
    expect(valid.result.propositions[0]!.quote).toBe(before);
    expect(Object.isFrozen(valid.result.propositions[0])).toBe(true);
    expect(Object.isFrozen(valid.result.propositions)).toBe(true);
  });

});
