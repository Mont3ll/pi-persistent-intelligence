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

function normalizedKey(key: string): string { return key.replace(/[_-]/g, "").toLowerCase(); }
function isSecretKey(key: string): boolean { const normalized = normalizedKey(key); return normalized === "authorization" || normalized === "proxyauthorization" || normalized === "password" || normalized === "secret" || normalized.endsWith("apikey") || normalized.endsWith("accesstoken") || normalized.endsWith("refreshtoken"); }
function isRequestKey(key: string): boolean { const normalized = normalizedKey(key); return normalized === "requestid" || normalized === "providerrequestid" || normalized === "traceid"; }
function redactString(value: string): string {
  return value
    .replace(/\/(?:home|Users)\/[^/\s"']+(?:\/[^\s"']*)?/g, "[private-path]")
    .replace(/\/(?:var\/)?tmp\/[^\s"']+/g, "[temporary-path]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted-userinfo]@")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ghp|github_pat)[_-][A-Za-z0-9_-]{8,}\b/gi, "[redacted-secret]");
}
function redact(value: unknown, key = ""): unknown {
  if (isSecretKey(key)) return "[redacted]";
  if (isRequestKey(key)) return "[provider-request-id-redacted]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  return value;
}
export function redactPublicArtifact<T>(value: T): T { return redact(value) as T; }
export function findPublicArtifactLeaks(value: unknown): string[] {
  const text = JSON.stringify(value); const findings: string[] = [];
  if (/\/(?:home|Users)\/[^\s"']+/.test(text)) findings.push("private_path");
  if (/\/(?:var\/)?tmp\/[^\s"']+/.test(text)) findings.push("temporary_path");
  if (/https?:\/\/[^\s/@:]+:[^\s/@]+@/i.test(text)) findings.push("url_userinfo");
  if (/\bBearer\s+(?!\[redacted\])[A-Za-z0-9._~+/-]+/i.test(text) || /\b(?:sk|ghp|github_pat)[_-][A-Za-z0-9_-]{8,}\b/i.test(text)) findings.push("secret");
  const visit = (item: unknown): void => { if (!item || typeof item !== "object") return; for (const [key, child] of Object.entries(item as Record<string, unknown>)) { if (isSecretKey(key) && child !== "[redacted]") findings.push("secret_field"); if (isRequestKey(key) && child !== "[provider-request-id-redacted]") findings.push("provider_request_id"); visit(child); } }; visit(value);
  return [...new Set(findings)];
}
export function validateRequiredArtifacts(root: string, relativePaths: string[]): string[] { return relativePaths.filter((path) => !existsSync(join(root, path))); }
