import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { listPatchFiles, readPatchFile, writePatchFile } from "../../src/patch";
import type { MemoryPatch } from "../../src/types";

let tempDirs: string[] = [];
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "pi-pi-patches-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function patch(id: string): MemoryPatch {
  return {
    patch_id: id,
    created_at: "2026-05-08T00:00:00Z",
    generated_by: "curator",
    mode: "propose",
    summary: "Test patch",
    ops: [],
    status: "proposed",
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
}

describe("patch files", () => {
  test("writes, lists, and reads patch files by id", () => {
    const root = tempRoot();
    ensureMemoryDirs(root);
    writePatchFile(root, patch("patch_a"));
    writePatchFile(root, patch("patch_b"));
    expect(listPatchFiles(root)).toEqual(["patch_a", "patch_b"]);
    expect(readPatchFile(root, "patch_b").patch_id).toBe("patch_b");
  });
});
