import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { readJsonl, writeJsonl } from "./jsonl";
import { ensureMemoryDirs } from "./paths";
import { resolveProjectIdentity } from "./profile";
import type { PiMemoryConfig } from "./config";
import type { ProjectIdentity, SessionActivity } from "./types";

export type CaptureActivityAction =
  | { kind: "read"; path: string }
  | { kind: "write"; path: string }
  | { kind: "command"; cwd: string; command: string };

export function actionsFromAgentMessages(messages: unknown[], fallbackCwd: string): CaptureActivityAction[] {
  const actions: CaptureActivityAction[] = [];
  for (const raw of messages.slice(-200)) {
    if (!raw || typeof raw !== "object") continue;
    const message = raw as Record<string, any>;
    if (message.role !== "toolResult" && message.role !== "tool") continue;
    const name = String(message.toolName ?? message.name ?? message.tool_name ?? "").toLowerCase();
    const input = (message.input && typeof message.input === "object" ? message.input : {}) as Record<string, unknown>;
    const details = (message.details && typeof message.details === "object" ? message.details : {}) as Record<string, unknown>;
    const path = String(input.path ?? input.file ?? details.path ?? details.file ?? "");
    if (/(^|[_.-])(read|fetch|get)([_.-]|$)/.test(name) && path) actions.push({ kind: "read", path });
    else if (/(^|[_.-])(edit|write|move|create|delete)([_.-]|$)/.test(name) && path) actions.push({ kind: "write", path });
    else if (/(^|[_.-])(bash|shell|exec)([_.-]|$)/.test(name)) {
      const command = String(input.command ?? details.command ?? "");
      if (command) actions.push({ kind: "command", command, cwd: String(input.cwd ?? details.cwd ?? fallbackCwd) });
    }
  }
  return actions.slice(-100);
}

export interface CollectActivityInput {
  session_id: string;
  turn_id: string;
  launch_cwd: string;
  actions: CaptureActivityAction[];
  resolver?: (path: string) => ProjectIdentity;
  explicit_project_mentions?: string[];
  now?: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeIdentity(identity: ProjectIdentity): ProjectIdentity {
  const gitRootHash = identity.git_root ? hash(identity.git_root) : identity.git_root_hash;
  return {
    project_id: identity.project_id,
    source: identity.source,
    display_name: identity.display_name ?? identity.package_name ?? identity.workspace_name ?? identity.project_id,
    git_remote_hash: identity.git_remote_hash,
    git_root_hash: gitRootHash,
    package_name: identity.package_name,
    workspace_name: identity.workspace_name,
    aliases: identity.aliases,
  };
}

function uniqueProjects(values: ProjectIdentity[]): ProjectIdentity[] {
  return [...new Map(values.map((item) => [item.project_id, safeIdentity(item)])).values()];
}

function commandClass(command: string): string {
  if (/\b(test|vitest|playwright|pytest)\b/i.test(command)) return "test";
  if (/\b(build|typecheck|tsc|cargo check|clippy|lint)\b/i.test(command)) return "build";
  if (/\bgit\s+(commit|push|merge|rebase|tag)\b/i.test(command)) return "git_mutation";
  if (/\b(publish|deploy|migrate|generate|install|remove|delete)\b/i.test(command)) return "mutation";
  return "command";
}

export function collectSessionActivity(input: CollectActivityInput): SessionActivity {
  const resolver = input.resolver ?? resolveProjectIdentity;
  const modified: ProjectIdentity[] = [];
  const read: ProjectIdentity[] = [];
  const modifiedPathHashes: string[] = [];
  const commandClasses: string[] = [];

  for (const action of input.actions) {
    if (action.kind === "read") {
      read.push(resolver(dirname(action.path)));
      continue;
    }
    if (action.kind === "write") {
      modified.push(resolver(dirname(action.path)));
      modifiedPathHashes.push(hash(action.path));
      continue;
    }
    modified.push(resolver(action.cwd));
    commandClasses.push(commandClass(action.command));
  }

  const modifiedProjects = uniqueProjects(modified);
  const modifiedIds = new Set(modifiedProjects.map((item) => item.project_id));
  const readProjects = uniqueProjects(read).filter((item) => !modifiedIds.has(item.project_id));
  const createdAt = input.now ?? new Date().toISOString();

  return {
    id: `activity_${hash(`${input.session_id}:${input.turn_id}`).slice(0, 20)}`,
    session_id: input.session_id,
    turn_id: input.turn_id,
    launch_cwd_hash: hash(input.launch_cwd),
    modified_projects: modifiedProjects,
    read_projects: readProjects,
    modified_path_hashes: [...new Set(modifiedPathHashes)],
    command_classes: [...new Set(commandClasses)],
    explicit_project_mentions: [...new Set(input.explicit_project_mentions ?? [])],
    created_at: createdAt,
  };
}

export function appendSessionActivity(root: string, activity: SessionActivity, config: PiMemoryConfig): void {
  const paths = ensureMemoryDirs(root);
  const rows = readJsonl<SessionActivity>(paths.runtime.captureActivity).filter((item) => item.id !== activity.id);
  rows.push(activity);
  const cutoff = Date.parse(activity.created_at) - config.capture.activityRetentionDays * 86_400_000;
  const retained = rows
    .filter((item) => Number.isFinite(Date.parse(item.created_at)) && Date.parse(item.created_at) >= cutoff)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-config.capture.activityRetentionCount);
  writeJsonl(paths.runtime.captureActivity, retained);
}

export function listSessionActivity(root: string, sessionId?: string): SessionActivity[] {
  const rows = readJsonl<SessionActivity>(ensureMemoryDirs(root).runtime.captureActivity);
  return sessionId ? rows.filter((item) => item.session_id === sessionId) : rows;
}
