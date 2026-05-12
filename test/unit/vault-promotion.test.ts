import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch } from "../../src/patch";
import type { MemoryPatch } from "../../src/types";

let dirs: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), "pi-pi-vault-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); dirs = []; });

describe("vault promotion report", () => {
  test("writes a report artifact without mutating the vault", () => {
    const dir = root();
    const patch: MemoryPatch = { patch_id: "patch_vault", created_at: "2026-05-09T00:00:00Z", generated_by: "manual", mode: "auto", summary: "vault", ops: [{ op_id: "op_001", op: "promote_to_vault_candidate", target_id: "mem_1", reason: "Stable across projects", risk: "medium", default_selected: true }], status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [] };
    applyPatch(dir, patch, { now: "2026-05-09T00:00:00Z" });
    const report = join(dir, "reports", "vault-promotion-patch_vault-op_001.md");
    expect(existsSync(report)).toBe(true);
    expect(readFileSync(report, "utf-8")).toContain("Stable across projects");
  });
});
