/**
 * Opt-in R4 semantic inference worker for the Pi SDK.
 *
 * No production hook imports this module. Invoke only through the existing
 * hard-deadline commandSemanticAdapter from the read-only evaluator:
 *
 * PI_R4_MODEL_BIN=bun
 * PI_R4_MODEL_ARGS='["scripts/r4-pi-semantic-worker.ts"]'
 * PI_R4_PI_PROVIDER=<explicit provider>
 * PI_R4_PI_MODEL=<explicit model id>
 * bun scripts/r4-semantic-evaluate.ts <privacy-reviewed-labelled.jsonl>
 *
 * The worker does not emit prompts or raw error messages. Its SDK session is
 * in-memory, tools disabled and resource discovery disabled. Its process still
 * inherits ambient OS/network privileges; isolate it at the OS level for
 * private real-session inputs. An outer subprocess hard timeout is required.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SemanticRequest } from "../src/semantic-assessment";

const MAX_REQUEST_BYTES = 36_000;
const MAX_MODEL_OUTPUT = 64 * 1024;
const MODEL_TIMEOUT_MS = 15_000;
const systemInstruction = [
  "You are a read-only semantic assessor of a single user-authored turn.",
  "Follow the JSON schema and the supplied source-span requirements exactly.",
  "Distinguish direct user endorsement from quotation and reported guidance.",
  "Identify duration, applicability and uncertainty; never invent source text.",
  "Never request tools, modify memory or assert canonical memory authority.",
  "If the source is insufficient, return outcome=abstain and propositions=[].",
].join(" ");

function assertInput(raw: unknown): asserts raw is SemanticRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_request");
  const r = raw as Partial<SemanticRequest>;
  if (r.version !== 1 || !r.source || r.source.role !== "user"
    || typeof r.source.text !== "string" || r.source.text.length === 0
    || r.source.text.length > 32_000 || typeof r.source.hash !== "string"
    || typeof r.source.sessionId !== "string" || typeof r.source.turnId !== "string"
    || typeof r.instructions !== "string") throw new Error("invalid_request");
}

async function run(): Promise<void> {
  const provider = process.env.PI_R4_PI_PROVIDER?.trim();
  const modelId = process.env.PI_R4_PI_MODEL?.trim();
  if (!provider || !modelId) throw new Error("explicit_model_required");
  const input = readFileSync(0, "utf8");
  if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) throw new Error("request_too_large");
  let parsed: unknown;
  try { parsed = JSON.parse(input) as unknown; }
  catch { throw new Error("invalid_request_json"); }
  assertInput(parsed);

  // Optional SDK import: not loaded in normal PI extension/runtime paths.
  const sdkPackage = "@earendil-works/pi-coding-agent";
  const aiPackage = "@earendil-works/pi-ai";
  const sdk = await import(sdkPackage);
  const ai = await import(aiPackage);
  const model = ai.getModel(provider, modelId);
  if (!model) throw new Error("model_unavailable");

  const sandbox = mkdtempSync(join(tmpdir(), "pi-r4-llm-eval-"));
  const agentDir = join(sandbox, "agent");
  mkdirSync(agentDir, { recursive: true });
  let session: { prompt(msg: string): Promise<void>; getLastAssistantText(): string | undefined;
    getActiveToolNames(): string[]; dispose(): void; abort(): void } | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false } });
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd: sandbox, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true,
      noThemes: true, noContextFiles: true,
      systemPromptOverride: () => systemInstruction,
    });
    await resourceLoader.reload();
    if (resourceLoader.getExtensions().extensions.length !== 0
      || resourceLoader.getSkills().skills.length !== 0
      || resourceLoader.getAgentsFiles().agentsFiles.length !== 0) {
      throw new Error("unexpected_discovered_resources");
    }
    const created = await sdk.createAgentSession({
      cwd: sandbox, agentDir, model, thinkingLevel: "off",
      noTools: "all", tools: [], customTools: [],
      sessionManager: sdk.SessionManager.inMemory(),
      settingsManager, resourceLoader,
    });
    session = created.session;
    if (session.getActiveToolNames().length !== 0) throw new Error("tools_not_disabled");
    deadline = setTimeout(() => session?.abort(), MODEL_TIMEOUT_MS);
    await session.prompt(JSON.stringify(parsed));
    if (!session) throw new Error("missing_session");
    const result = session.getLastAssistantText();
    if (!result || Buffer.byteLength(result) > MAX_MODEL_OUTPUT) throw new Error("invalid_model_output");
    let output: unknown;
    try { output = JSON.parse(result) as unknown; }
    catch { throw new Error("invalid_model_json"); }
    // No prompts, transcript or raw model output in diagnostics.
    process.stdout.write(JSON.stringify(output) + "\n");
  } finally {
    if (deadline) clearTimeout(deadline);
    session?.dispose();
    rmSync(sandbox, { recursive: true, force: true });
  }
}

try {
  await run();
} catch {
  process.stderr.write("semantic_worker_unavailable\n");
  process.exitCode = 1;
}
