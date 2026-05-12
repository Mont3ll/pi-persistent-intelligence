import { execFile } from "node:child_process";

export const qmdCollectionName = "pi-persistent-intelligence";

export type MemorySearchMode = "keyword" | "semantic" | "deep";

export function qmdSetupCommands(root: string, collection = qmdCollectionName): string[][] {
  return [
    ["collection", "add", root, "--name", collection],
    ["context", "add", `qmd://${collection}/rendered`, "Rendered long-term memory projections", "-c", collection],
    ["context", "add", `qmd://${collection}/daily`, "Daily session logs and operational context", "-c", collection],
    // Session summaries — written by SessionStore.exportMarkdown()
    ["context", "add", `qmd://${collection}/sessions`, "Past session summaries for semantic search", "-c", collection],
  ];
}

export function qmdSearchArgs(query: string, mode: MemorySearchMode, limit: number, collection = qmdCollectionName): string[] {
  const command = mode === "keyword" ? "search" : mode === "semantic" ? "vsearch" : "query";
  return [command, "--json", "-c", collection, "-n", String(limit), query];
}

export function qmdUpdateArgs(collection = qmdCollectionName): string[] {
  return ["update", "-c", collection];
}

export function runQmd(args: string[], timeout = 30_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("qmd", args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve({ stdout, stderr });
    });
  });
}

export async function setupQmd(root: string, collection = qmdCollectionName): Promise<void> {
  for (const args of qmdSetupCommands(root, collection)) {
    try {
      await runQmd(args, 10_000);
    } catch {
      // Best-effort: collection/context may already exist.
    }
  }
}

export async function updateQmd(collection = qmdCollectionName): Promise<void> {
  try {
    await runQmd(qmdUpdateArgs(collection), 30_000);
  } catch {
    // qmd is optional; never block memory writes on qmd availability.
  }
}
