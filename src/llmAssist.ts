import { execFile } from "node:child_process";
import type { CaptureCandidate, MemoryRecord } from "./types";

export interface LlmAssistConfig {
  enabled: boolean;
  model: string | null;
  instructions?: string;
  command?: string | null;
}

export interface LlmAssistPlan {
  enabled: boolean;
  model?: string;
  instructions?: string;
  command?: string | null;
}

export interface LlmAssistRequestInput {
  task: "curate" | "maintain";
  candidates: CaptureCandidate[];
  records: MemoryRecord[];
}

export interface LlmAssistRequest extends LlmAssistRequestInput {
  instructions: string;
}

export function getLlmAssistPlan(config: LlmAssistConfig): LlmAssistPlan {
  if (!config.enabled) return { enabled: false };
  if (!config.model) throw new Error("LLM assistance requires config.llm.model");
  return config.command === undefined
    ? { enabled: true, model: config.model, instructions: config.instructions }
    : { enabled: true, model: config.model, instructions: config.instructions, command: config.command };
}

export function buildLlmAssistRequest(input: LlmAssistRequestInput): LlmAssistRequest {
  return {
    ...input,
    instructions: [
      "Return JSON only.",
      "Suggest memory patch operations, but do not assume authority to mutate memory.",
      "Respect L1/L2 evidence thresholds and mark risky operations for supervised review.",
    ].join(" "),
  };
}

function splitCommand(command: string): { file: string; args: string[] } {
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^['"]|['"]$/g, "")) ?? [];
  if (!parts[0]) throw new Error("LLM assistance command is empty");
  return { file: parts[0], args: parts.slice(1) };
}

export async function runConfiguredLlmAssist(config: LlmAssistConfig, input: LlmAssistRequestInput): Promise<unknown> {
  const plan = getLlmAssistPlan(config);
  if (!plan.enabled) return null;
  if (!plan.command) throw new Error("LLM assistance requires config.llm.command for extension-side execution");
  const { file, args } = splitCommand(plan.command);
  const request = buildLlmAssistRequest(input);
  return await new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else {
        try {
          resolve(JSON.parse(stdout || "null"));
        } catch (parseError) {
          reject(parseError);
        }
      }
    });
    child.stdin?.end(JSON.stringify(request));
  });
}
