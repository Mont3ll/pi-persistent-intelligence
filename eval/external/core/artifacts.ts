import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalJson } from "./canonical-json";

function atomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, text, { mode: 0o600 }); renameSync(temporary, path);
}
export function writeJsonAtomic(path: string, value: unknown): void { atomic(path, `${canonicalJson(value)}\n`); }
export function appendJsonlAtomic(path: string, value: unknown): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  atomic(path, `${existing}${canonicalJson(value)}\n`);
}
export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
}

const SECRET_KEYS = /^(authorization|proxyAuthorization|apiKey|accessToken|refreshToken|secret|password)$/i;
const REQUEST_KEYS = /^(requestId|providerRequestId|traceId)$/i;
function redactString(value: string): string {
  return value
    .replace(/\/(?:home|Users)\/[^/\s"']+(?:\/[^\s"']*)?/g, "[private-path]")
    .replace(/\/tmp\/[^\s"']+/g, "[temporary-path]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{8,}\b/g, "[redacted-secret]");
}
function redact(value: unknown, key = ""): unknown {
  if (SECRET_KEYS.test(key)) return "[redacted]";
  if (REQUEST_KEYS.test(key)) return "[provider-request-id-redacted]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  return value;
}
export function redactPublicArtifact<T>(value: T): T { return redact(value) as T; }
export function validateRequiredArtifacts(root: string, relativePaths: string[]): string[] { return relativePaths.filter((path) => !existsSync(join(root, path))); }
