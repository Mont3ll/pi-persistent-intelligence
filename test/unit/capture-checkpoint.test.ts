import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasProcessedMessage, readCaptureCheckpoint, writeCaptureCheckpoint } from "../../src/capture-checkpoint";

const dirs: string[] = [];
function root(): string { const dir = mkdtempSync(join(tmpdir(), "pi-capture-checkpoint-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs.length = 0; });

describe("capture checkpoints", () => {
  test("persists one checkpoint per session and caps message hashes", () => {
    const dir = root();
    writeCaptureCheckpoint(dir, { session_id: "s1", last_turn_id: "t1", processed_message_hashes: Array.from({ length: 80 }, (_, index) => `h${index}`), updated_at: "2026-07-26T00:00:00Z" });
    const checkpoint = readCaptureCheckpoint(dir, "s1");
    expect(checkpoint?.last_turn_id).toBe("t1");
    expect(checkpoint?.processed_message_hashes).toHaveLength(60);
    expect(hasProcessedMessage(checkpoint, "h79")).toBe(true);
    expect(hasProcessedMessage(checkpoint, "h0")).toBe(false);
  });

  test("updates a session without overwriting another session", () => {
    const dir = root();
    writeCaptureCheckpoint(dir, { session_id: "s1", last_turn_id: "t1", processed_message_hashes: ["a"], updated_at: "2026-07-26T00:00:00Z" });
    writeCaptureCheckpoint(dir, { session_id: "s2", last_turn_id: "t1", processed_message_hashes: ["b"], updated_at: "2026-07-26T00:00:01Z" });
    writeCaptureCheckpoint(dir, { session_id: "s1", last_turn_id: "t2", processed_message_hashes: ["a", "c"], updated_at: "2026-07-26T00:00:02Z" });
    expect(readCaptureCheckpoint(dir, "s1")?.last_turn_id).toBe("t2");
    expect(readCaptureCheckpoint(dir, "s2")?.processed_message_hashes).toEqual(["b"]);
  });
});
