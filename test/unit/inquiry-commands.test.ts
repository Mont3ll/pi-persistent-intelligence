import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import persistentIntelligence from "../../index";
import { appendInquiryRecord, createInquiryRecord, findInquiryById } from "../../src/inquiries";
import { ensureMemoryDirs } from "../../src/paths";
import { unsafeAddMemoryRecord } from "../../src/store";
import type { MemoryRecord } from "../../src/types";

let root = ""; let oldRoot: string | undefined;
afterEach(() => { if (oldRoot === undefined) delete process.env.PI_MEMORY_ROOT; else process.env.PI_MEMORY_ROOT = oldRoot; if (root) rmSync(root, { recursive: true, force: true }); });

function setup() {
  oldRoot = process.env.PI_MEMORY_ROOT;
  root = mkdtempSync(join(tmpdir(), "pi-inquiry-command-")); process.env.PI_MEMORY_ROOT = root; ensureMemoryDirs(root);
  const inquiry = appendInquiryRecord(root, createInquiryRecord({ question: "Keep this?", context: "test", now: "2026-07-01T00:00:00Z" }));
  const memory: MemoryRecord = { id: "mem_answer", layer: "L2", scope: { type: "global" }, tags: [], statement: "Answer.", evidence: [{ type: "manual", ref: "test", note: "test" }], confidence: 0.8, stability: "low", created_at: "2026-07-01", updated_at: "2026-07-01", review: { cadence_days: 30, next_review: "2026-08-01", change_condition: "change" }, status: "active", supersedes: [], superseded_by: [], vault_ref: null };
  unsafeAddMemoryRecord(root, memory);
  const commands = new Map<string, any>(); const notifications: string[] = [];
  persistentIntelligence({ on() {}, exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }), getAllTools: () => [], sendUserMessage() {}, registerTool() {}, registerCommand(name: string, value: unknown) { commands.set(name, value); } } as any);
  return { inquiry, commands, notifications, ctx: { cwd: root, ui: { notify: (message: string) => notifications.push(message) } } as any };
}

describe("/memory-inquiries", () => {
  test("lists by status and answers only with an existing active memory", async () => {
    const { inquiry, commands, notifications, ctx } = setup();
    await commands.get("memory-inquiries").handler("list --status open --json", ctx);
    expect(JSON.parse(notifications.at(-1)!)).toHaveLength(1);

    await commands.get("memory-inquiries").handler(`answer ${inquiry.id} --memory missing`, ctx);
    expect(notifications.at(-1)).toContain("does not exist");
    expect(findInquiryById(root, inquiry.id)?.status).toBe("open");

    await commands.get("memory-inquiries").handler(`answer ${inquiry.id} --memory mem_answer --json`, ctx);
    expect(JSON.parse(notifications.at(-1)!)).toMatchObject({ previous_status: "open", status: "answered", answer_memory_id: "mem_answer" });
    expect(findInquiryById(root, inquiry.id)?.status).toBe("answered");

    await commands.get("memory-inquiries").handler(`answer ${inquiry.id} --memory mem_answer`, ctx);
    expect(notifications.at(-1)).toContain("cannot transition");
  });

  test("withdraws and marks stale only from open state and reports missing inquiries", async () => {
    const { inquiry, commands, notifications, ctx } = setup();
    await commands.get("memory-inquiries").handler(`withdraw ${inquiry.id} --json`, ctx);
    expect(JSON.parse(notifications.at(-1)!)).toMatchObject({ status: "withdrawn" });
    await commands.get("memory-inquiries").handler(`stale ${inquiry.id}`, ctx);
    expect(notifications.at(-1)).toContain("cannot transition");
    await commands.get("memory-inquiries").handler("withdraw missing", ctx);
    expect(notifications.at(-1)).toContain("not found");
  });
});
