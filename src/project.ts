import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, parse } from "node:path";
import type { MemoryScope } from "./types";

function findUp(start: string, filename: string): string | null {
  let current = start;
  while (true) {
    const candidate = join(current, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function inferProjectName(cwd = process.cwd()): string {
  const pkg = findUp(cwd, "package.json");
  if (pkg) {
    try {
      const parsed = JSON.parse(readFileSync(pkg, "utf-8")) as { name?: string };
      if (parsed.name) return parsed.name;
    } catch {
      // Fall through to directory-based inference.
    }
    return basename(dirname(pkg));
  }
  const git = findUp(cwd, ".git");
  if (git) return basename(dirname(git));
  return basename(parse(cwd).dir ? cwd : process.cwd());
}

export function inferProjectScope(cwd = process.cwd()): MemoryScope {
  return { type: "project", project: inferProjectName(cwd) };
}
