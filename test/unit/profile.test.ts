import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../../src/paths";
import { resolveMemoryProfile, defaultResourceId } from "../../src/profile";

let dirs: string[] = [];
function tempDir(prefix = "pi-pi-profile-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("profile resolution", () => {
  test("creates a default project profile in profiles.jsonl", () => {
    const root = tempDir();
    const cwd = tempDir("pi-pi-project-cwd-");
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "example-app" }), "utf-8");
    ensureMemoryDirs(root);

    const profile = resolveMemoryProfile(root, cwd, "2026-05-19T10:00:00.000Z");

    expect(profile.resource_id).toBe(defaultResourceId());
    expect(profile.profile_type).toBe("project");
    expect(profile.project_identity?.package_name).toBe("example-app");
    expect(profile.profile_id).toContain("project:");
    const persisted = readFileSync(join(root, "memory", "profiles.jsonl"), "utf-8");
    expect(persisted).toContain(profile.profile_id);
    expect(persisted).toContain("example-app");
  });

  test("uses explicit project identity from .pi/settings.json when available", () => {
    const root = tempDir();
    const cwd = tempDir("pi-pi-explicit-cwd-");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({
      "pi-persistent-intelligence": {
        projectIdentity: { project_id: "explicit-pi", aliases: ["pi-pi"] }
      }
    }), "utf-8");
    ensureMemoryDirs(root);

    const profile = resolveMemoryProfile(root, cwd, "2026-05-19T10:00:00.000Z");

    expect(profile.project_identity?.source).toBe("explicit_config");
    expect(profile.project_identity?.project_id).toBe("explicit-pi");
    expect(profile.profile_id).toBe("project:explicit-pi");
  });
});
