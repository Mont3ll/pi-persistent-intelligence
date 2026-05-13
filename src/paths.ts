import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface MemoryPaths {
  root: string;
  config: string;
  schemas: { memory: string; patch: string };
  memory: { dir: string; L1: string; L2: string; projects: string };
  rendered: { dir: string; memory: string; projects: string };
  scratchpad: string;
  daily: string;
  inbox: { dir: string; captured: string };
  patches: string;
  runtime: { dir: string; context: string; selected: string };
  reports: string;
  sessions: string;
  search: string;
}

export function defaultRoot(home = process.env.HOME ?? homedir()): string {
  return process.env.PI_MEMORY_ROOT ?? join(home, ".pi", "agent", "pi-memory");
}

/**
 * Resolve the memory root for a given working directory.
 *
 * Priority (highest → lowest):
 *   1. PI_MEMORY_ROOT env var
 *   2. "pi-persistent-intelligence".localPath in {cwd}/.pi/settings.json
 *   3. "pi-pi".localPath cascade (short alias)
 *   4. Global default: ~/.pi/agent/pi-memory/
 */
export function resolveRoot(cwd?: string): string {
  if (process.env.PI_MEMORY_ROOT) return process.env.PI_MEMORY_ROOT;

  if (cwd) {
    try {
      const localSettings = join(cwd, ".pi", "settings.json");
      if (existsSync(localSettings)) {
        const settings = JSON.parse(readFileSync(localSettings, "utf-8")) as Record<string, unknown>;

        // Package-specific key wins
        const piPi = settings["pi-persistent-intelligence"] as Record<string, unknown> | undefined;
        if (typeof piPi?.localPath === "string" && piPi.localPath) return piPi.localPath;

        // Short-alias cascade
        const piAlias = settings["pi-pi"] as Record<string, unknown> | undefined;
        if (typeof piAlias?.localPath === "string" && piAlias.localPath) return join(piAlias.localPath, "pi-memory");
      }
    } catch { /* fall through */ }
  }

  return defaultRoot();
}

export function resolvePaths(root = defaultRoot()): MemoryPaths {
  return {
    root,
    config: join(root, "config.json"),
    schemas: { memory: join(root, "schemas", "memory.schema.json"), patch: join(root, "schemas", "patch.schema.json") },
    memory: {
      dir: join(root, "memory"),
      L1: join(root, "memory", "L1.identity.jsonl"),
      L2: join(root, "memory", "L2.playbooks.jsonl"),
      projects: join(root, "memory", "projects"),
    },
    rendered: { dir: join(root, "rendered"), memory: join(root, "rendered", "MEMORY.md"), projects: join(root, "rendered", "projects") },
    scratchpad: join(root, "scratchpad.md"),
    daily: join(root, "daily"),
    inbox: { dir: join(root, "inbox"), captured: join(root, "inbox", "captured.jsonl") },
    patches: join(root, "patches"),
    runtime: { dir: join(root, "runtime"), context: join(root, "runtime", "context.md"), selected: join(root, "runtime", "selected_memory.json") },
    reports: join(root, "reports"),
    sessions: join(root, "sessions"),
    search: join(root, "search"),
  };
}

export function ensureMemoryDirs(root = defaultRoot()): MemoryPaths {
  const paths = resolvePaths(root);
  for (const dir of [
    paths.root,
    join(paths.root, "schemas"),
    paths.memory.dir,
    paths.memory.projects,
    paths.rendered.dir,
    paths.rendered.projects,
    paths.daily,
    paths.inbox.dir,
    paths.patches,
    paths.runtime.dir,
    paths.reports,
    paths.sessions,
    paths.search,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  for (const file of [paths.memory.L1, paths.memory.L2, paths.inbox.captured]) {
    if (!existsSync(file)) writeFileSync(file, "", "utf-8");
  }
  if (!existsSync(paths.scratchpad)) writeFileSync(paths.scratchpad, "# Scratchpad\n\n", "utf-8");
  return paths;
}
