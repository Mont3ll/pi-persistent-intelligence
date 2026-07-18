import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import persistentIntelligence from "../../index";
import { ensureMemoryDirs } from "../../src/paths";
import type { MemoryRecord } from "../../src/types";

const roots: string[] = [];
let oldRoot: string | undefined;

afterEach(() => {
  if (oldRoot === undefined) delete process.env.PI_MEMORY_ROOT; else process.env.PI_MEMORY_ROOT = oldRoot;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  oldRoot = process.env.PI_MEMORY_ROOT;
  const root = mkdtempSync(join(tmpdir(), "pi-reconcile-command-"));
  roots.push(root);
  process.env.PI_MEMORY_ROOT = root;
  const paths = ensureMemoryDirs(root);
  const record: MemoryRecord = {
    id: "rec_local", layer: "L2", scope: { type: "global" }, tags: ["interop"],
    statement: "Local independent record.", evidence: [{ type: "manual", ref: "fixture:local", note: "test" }],
    confidence: 0.9, stability: "semi-stable", created_at: "2026-07-18T00:00:00Z", updated_at: "2026-07-18T00:00:00Z",
    review: { cadence_days: 30, next_review: "2026-08-17", change_condition: "If peer differs." },
    status: "active", supersedes: [], superseded_by: [], vault_ref: null,
  };
  writeFileSync(paths.memory.L2, `${JSON.stringify(record)}\n`, "utf-8");
  const peer = join(root, "peer.json");
  writeFileSync(peer, readFileSync(join(import.meta.dir, "../fixtures/pi-governance-conformance/filtered-bundle.json")));
  const canonical = [paths.memory.L1, paths.memory.L2, paths.memory.profiles, paths.memory.evidence, paths.memory.inquiries, paths.memory.reinforcement, paths.memory.tombstones, paths.memory.portableEvents, paths.inbox.captured];
  const before = canonical.map((file) => ({ file, bytes: readFileSync(file), mtime: statSync(file).mtimeMs }));
  const commands = new Map<string, any>();
  const notifications: string[] = [];
  persistentIntelligence({
    on() {}, exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    getAllTools: () => [], sendUserMessage() {}, registerTool() {},
    registerCommand(name: string, definition: unknown) { commands.set(name, definition); },
  } as any);
  const ctx = { cwd: root, ui: { notify: (message: string) => notifications.push(message) } } as any;
  return { peer, before, commands, notifications, ctx };
}

describe("/memory-reconcile", () => {
  test("reports peer differences without changing canonical bytes or mtimes", async () => {
    const { peer, before, commands, notifications, ctx } = setup();

    await commands.get("memory-reconcile").handler(`${peer} --json`, ctx);

    const report = JSON.parse(notifications.at(-1)!);
    expect(report).toMatchObject({ dry_run: true, mutation_performed: false });
    expect(report.sections.records.source_only_ids).toContain("rec_local");
    for (const snapshot of before) {
      expect(readFileSync(snapshot.file)).toEqual(snapshot.bytes);
      expect(statSync(snapshot.file).mtimeMs).toBe(snapshot.mtime);
    }
  });
});
