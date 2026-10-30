import { execFile } from "node:child_process";
import type { SemanticAdapter, SemanticRequest } from "./semantic-assessment";

/**
 * Optional, explicitly configured LLM command adapter for an isolated pilot.
 * No shell interpretation, no persistent cache, no store handle, no mutation.
 * Never enable by default or call from the production capture hook.
 */
export function commandSemanticAdapter(
  executable: string,
  args: readonly string[] = [],
  timeoutMs = 20_000,
): SemanticAdapter {
  if (!executable || timeoutMs < 100 || timeoutMs > 60_000
    || args.some(arg => typeof arg !== "string")) {
    throw new Error("invalid_semantic_command_configuration");
  }
  return {
    assess(req: SemanticRequest): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const child = execFile(executable, [...args], {
          timeout: timeoutMs, maxBuffer: 64 * 1024,
          shell: false, windowsHide: true, encoding: "utf8",
        }, (err, stdout) => {
          if (err) { reject(new Error("semantic_assessor_failed")); return; }
          try { resolve(JSON.parse(stdout)); }
          catch { reject(new Error("semantic_assessor_invalid_json")); }
        });
        child.stdin?.on("error", () => { /* handled by subprocess result */ });
        child.stdin?.end(JSON.stringify(req));
      });
    },
  };
}
