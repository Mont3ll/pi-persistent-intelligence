import { readFileSync } from "node:fs";
import { redactSecrets } from "../src/secret-scanner";

export type NpmFailureKind =
  | "duplicate"
  | "authentication"
  | "permission"
  | "network"
  | "not-found"
  | "other";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GuardedPublishOptions {
  packageName: string;
  version: string;
  publishArgs: string[];
  runCommand?: (args: string[]) => Promise<CommandResult>;
}

export interface GuardedPublishResult {
  status: "published" | NpmFailureKind;
  exitCode: number;
  diagnostic?: string;
}

export function validatePublishTag(tag: string, version: string): void {
  const expectedTag = `v${version}`;
  if (tag !== expectedTag) {
    throw new Error(`Pushed tag ${tag} does not match package version ${version}`);
  }
}

export function classifyNpmFailure(output: string): NpmFailureKind {
  const normalized = output.toLowerCase();

  if (
    normalized.includes("epublishconflict") ||
    normalized.includes("cannot publish over") ||
    normalized.includes("previously published") ||
    normalized.includes("version already exists") ||
    normalized.includes("cannot publish the same version") ||
    normalized.includes("409 conflict")
  ) {
    return "duplicate";
  }
  if (
    normalized.includes("e401") ||
    normalized.includes("eneedauth") ||
    normalized.includes("eotp") ||
    normalized.includes("unauthorized") ||
    normalized.includes("authentication")
  ) {
    return "authentication";
  }
  if (normalized.includes("e403") || normalized.includes("eacces") || normalized.includes("permission")) {
    return "permission";
  }
  if (
    normalized.includes("enetwork") ||
    normalized.includes("enotfound") ||
    normalized.includes("eai_again") ||
    normalized.includes("econnreset") ||
    normalized.includes("econnrefused") ||
    normalized.includes("etimedout") ||
    normalized.includes("network")
  ) {
    return "network";
  }
  if (normalized.includes("e404") || normalized.includes("404 not found") || normalized.includes("not in this registry")) {
    return "not-found";
  }
  return "other";
}

export function publishFailureExitCode(kind: NpmFailureKind): number {
  return kind === "duplicate" ? 0 : 1;
}

export function formatNpmDiagnostic(output: string): string {
  return redactSecrets(output.trim()).slice(0, 2000);
}

async function runNpm(args: string[]): Promise<CommandResult> {
  const process = Bun.spawn(["npm", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: processEnv(),
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

function processEnv(): Record<string, string | undefined> {
  return { ...process.env };
}

export async function runGuardedPublish(options: GuardedPublishOptions): Promise<GuardedPublishResult> {
  const runCommand = options.runCommand ?? runNpm;
  const packageSpec = `${options.packageName}@${options.version}`;
  const preflight = await runCommand(["view", packageSpec, "version", "--json"]);

  if (preflight.exitCode === 0) {
    return { status: "duplicate", exitCode: 0 };
  }

  const preflightOutput = `${preflight.stdout}\n${preflight.stderr}`;
  const preflightKind = classifyNpmFailure(preflightOutput);
  if (preflightKind !== "not-found") {
    return {
      status: preflightKind,
      exitCode: 1,
      diagnostic: formatNpmDiagnostic(preflightOutput),
    };
  }

  const published = await runCommand(["publish", ...options.publishArgs]);
  if (published.exitCode === 0) {
    return { status: "published", exitCode: 0 };
  }

  const publishOutput = `${published.stdout}\n${published.stderr}`;
  const publishKind = classifyNpmFailure(publishOutput);
  return {
    status: publishKind,
    exitCode: publishFailureExitCode(publishKind),
    ...(publishKind === "duplicate" ? {} : { diagnostic: formatNpmDiagnostic(publishOutput) }),
  };
}

function readPackage(): { name: string; version: string } {
  const value = JSON.parse(readFileSync("package.json", "utf8")) as { name?: unknown; version?: unknown };
  if (typeof value.name !== "string" || typeof value.version !== "string") {
    throw new Error("package.json must contain string name and version fields");
  }
  return { name: value.name, version: value.version };
}

async function main(): Promise<number> {
  const [command, ...args] = Bun.argv.slice(2);
  const packageMetadata = readPackage();

  if (command === "verify-tag") {
    const tag = args[0] ?? process.env.GITHUB_REF_NAME ?? "";
    validatePublishTag(tag, packageMetadata.version);
    console.log(`Verified publish tag ${tag} for ${packageMetadata.name}@${packageMetadata.version}`);
    return 0;
  }

  if (command === "publish") {
    const result = await runGuardedPublish({
      packageName: packageMetadata.name,
      version: packageMetadata.version,
      publishArgs: args,
    });
    console.log(`npm publish result: ${result.status}`);
    if (result.diagnostic) console.error(result.diagnostic);
    return result.exitCode;
  }

  throw new Error("Usage: bun scripts/publish-guard.ts <verify-tag [tag] | publish [npm publish args...]>");
}

if (import.meta.main) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
