import { spawn } from "node:child_process";
import type { SemanticAdapter, SemanticRequest } from "./semantic-assessment";

const MAX_STDOUT_BYTES = 64 * 1024;

/**
 * Optional operator-selected local adapter. This is NOT an OS sandbox:
 * the executable retains ambient filesystem/network privileges.
 * Never launch automatically from production capture.
 */
export function commandSemanticAdapter(
  executable: string,
  args: readonly string[] = [],
  timeoutMs = 20_000,
): SemanticAdapter {
  if (!executable || !Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000
    || args.some(arg => typeof arg !== "string")) {
    throw new Error("invalid_semantic_command_configuration");
  }
  return {
    assess(req: SemanticRequest): Promise<unknown> {
      return new Promise((resolve, reject) => {
        let done = false;
        let bytes = 0;
        const chunks: Buffer[] = [];
        const child = spawn(executable, [...args], {
          shell: false, windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
        });
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: string, value?: unknown): void => {
          if (done) return;
          done = true;
          if (deadline) clearTimeout(deadline);
          if (error) reject(new Error(error));
          else resolve(value);
        };
        // A hard SIGKILL plus immediate promise rejection: child-process
        // timeout normally starts with SIGTERM, which a model can ignore.
        deadline = setTimeout(() => {
          child.kill("SIGKILL");
          finish("semantic_assessor_deadline_exceeded");
        }, timeoutMs);
        child.on("error", () => finish("semantic_assessor_failed"));
        child.stdout.on("data", (chunk: Buffer) => {
          if (done) return;
          bytes += chunk.length;
          if (bytes > MAX_STDOUT_BYTES) {
            child.kill("SIGKILL");
            finish("semantic_assessor_output_limit");
          } else chunks.push(chunk);
        });
        child.on("close", code => {
          if (done) return;
          if (code !== 0) { finish("semantic_assessor_failed"); return; }
          try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch { finish("semantic_assessor_invalid_json"); }
        });
        child.stdin.on("error", () => { /* model may terminate before reading */ });
        try { child.stdin.end(JSON.stringify(req)); }
        catch {
          child.kill("SIGKILL");
          finish("semantic_assessor_invalid_request");
        }
      });
    },
  };
}
