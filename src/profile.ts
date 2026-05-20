import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { userInfo } from "node:os";
import { readJsonl, writeJsonl } from "./jsonl";
import { ensureMemoryDirs } from "./paths";
import type { MemoryProfile, ProjectIdentity } from "./types";

function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function slug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "default";
}

function findUp(start: string, name: string): string | null {
  let current = start;
  while (true) {
    const candidate = join(current, name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function explicitProjectIdentity(cwd: string): ProjectIdentity | null {
  const settingsPath = join(cwd, ".pi", "settings.json");
  if (!existsSync(settingsPath)) return null;
  const settings = readJsonFile(settingsPath);
  const config = settings?.["pi-persistent-intelligence"] as Record<string, unknown> | undefined;
  const identity = config?.projectIdentity as Record<string, unknown> | undefined;
  if (!identity || typeof identity.project_id !== "string" || !identity.project_id.trim()) return null;
  return {
    project_id: slug(identity.project_id),
    source: "explicit_config",
    aliases: Array.isArray(identity.aliases) ? identity.aliases.filter((item): item is string => typeof item === "string") : undefined,
  };
}

function gitRemoteIdentity(cwd: string): ProjectIdentity | null {
  const gitDir = findUp(cwd, ".git");
  if (!gitDir) return null;
  const configPath = join(gitDir, "config");
  if (!existsSync(configPath)) return null;
  const content = readFileSync(configPath, "utf-8");
  const match = content.match(/\[remote "origin"\][\s\S]*?\n\s*url\s*=\s*(.+)/);
  const remote = match?.[1]?.trim();
  if (!remote) return null;
  return {
    project_id: `git-${hash(remote)}`,
    source: "git_remote",
    git_remote_hash: hash(remote),
    git_root: dirname(gitDir),
  };
}

function packageIdentity(cwd: string): ProjectIdentity | null {
  const pkgPath = findUp(cwd, "package.json");
  if (!pkgPath) return null;
  const pkg = readJsonFile(pkgPath);
  const name = typeof pkg?.name === "string" && pkg.name.trim() ? pkg.name : basename(dirname(pkgPath));
  return {
    project_id: slug(name),
    source: "package_name",
    package_name: name,
  };
}

function gitRootIdentity(cwd: string): ProjectIdentity | null {
  const gitDir = findUp(cwd, ".git");
  if (!gitDir) return null;
  const root = dirname(gitDir);
  return {
    project_id: `gitroot-${hash(root)}`,
    source: "git_root",
    git_root: root,
  };
}

export function defaultResourceId(): string {
  try {
    return `user:${slug(userInfo().username)}`;
  } catch {
    return "user:local";
  }
}

export function resolveProjectIdentity(cwd = process.cwd()): ProjectIdentity {
  return explicitProjectIdentity(cwd)
    ?? gitRemoteIdentity(cwd)
    ?? gitRootIdentity(cwd)
    ?? packageIdentity(cwd)
    ?? { project_id: slug(basename(cwd)), source: "cwd_fallback" };
}

function upsertProfile(root: string, profile: MemoryProfile): MemoryProfile {
  const paths = ensureMemoryDirs(root);
  const profiles = readJsonl<MemoryProfile>(paths.memory.profiles);
  const index = profiles.findIndex((item) => item.profile_id === profile.profile_id && item.resource_id === profile.resource_id);
  if (index >= 0) {
    const existing = profiles[index];
    const updated = { ...existing, ...profile, created_at: existing.created_at, updated_at: profile.updated_at };
    profiles[index] = updated;
    writeJsonl(paths.memory.profiles, profiles);
    return updated;
  }
  profiles.push(profile);
  writeJsonl(paths.memory.profiles, profiles);
  return profile;
}

export function resolveMemoryProfile(root: string, cwd = process.cwd(), now = new Date().toISOString()): MemoryProfile {
  const projectIdentity = resolveProjectIdentity(cwd);
  const profile: MemoryProfile = {
    profile_id: `project:${projectIdentity.project_id}`,
    profile_type: "project",
    resource_id: defaultResourceId(),
    project_identity: projectIdentity,
    storage_root: root,
    created_at: now,
    updated_at: now,
  };
  return upsertProfile(root, profile);
}
