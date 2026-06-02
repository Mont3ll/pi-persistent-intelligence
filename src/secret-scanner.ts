export type SecretFindingKind =
  | "openai_api_key"
  | "github_token"
  | "aws_access_key"
  | "ssh_private_key"
  | "private_key_pem"
  | "bearer_token"
  | "env_secret"
  | "oauth_token";

export interface SecretFinding {
  kind: SecretFindingKind;
  confidence: "high" | "medium" | "low";
  start: number;
  end: number;
  redaction: string;
  preview: string;
}

export interface SecretScanResult {
  findings: SecretFinding[];
  hasHighConfidenceSecret: boolean;
  redacted: string;
}

export interface SecretScanPolicy {
  blockHighConfidence: boolean;
  redactReports: boolean;
  reviewMediumConfidence: boolean;
}

export const DEFAULT_SECRET_SCAN_POLICY: SecretScanPolicy = {
  blockHighConfidence: true,
  redactReports: true,
  reviewMediumConfidence: true,
};

interface PatternDef {
  kind: SecretFindingKind;
  confidence: "high" | "medium" | "low";
  pattern: RegExp;
  priority: number;
}

type InternalFinding = SecretFinding & { priority: number };

const KEY_BLOCK_LABEL = "PRIVATE " + "KEY";
const OPENSSH_BEGIN = "BEGIN OPENSSH " + KEY_BLOCK_LABEL;
const OPENSSH_END = "END OPENSSH " + KEY_BLOCK_LABEL;
const PEM_BEGIN = "BEGIN (?:RSA |EC |DSA |)?" + KEY_BLOCK_LABEL;
const PEM_END = "END (?:RSA |EC |DSA |)?" + KEY_BLOCK_LABEL;

const PATTERNS: PatternDef[] = [
  { kind: "ssh_private_key", confidence: "high", priority: 100, pattern: new RegExp("-----" + OPENSSH_BEGIN + "-----[\\s\\S]*?-----" + OPENSSH_END + "-----", "g") },
  { kind: "private_key_pem", confidence: "high", priority: 95, pattern: new RegExp("-----" + PEM_BEGIN + "-----[\\s\\S]*?-----" + PEM_END + "-----", "g") },
  { kind: "openai_api_key", confidence: "high", priority: 90, pattern: /\bsk-(?:proj|live|test)?-[A-Za-z0-9_-]{32,}\b/g },
  { kind: "github_token", confidence: "high", priority: 90, pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b/g },
  { kind: "aws_access_key", confidence: "high", priority: 90, pattern: new RegExp("\\b(?:" + "AK" + "IA|AS" + "IA)[A-Z0-9]{16}\\b", "g") },
  { kind: "bearer_token", confidence: "high", priority: 80, pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{32,}\b/g },
  { kind: "oauth_token", confidence: "high", priority: 75, pattern: /\b(?:access_token|refresh_token|oauth_token)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{32,}["']?/gi },
  { kind: "env_secret", confidence: "high", priority: 10, pattern: /\b[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*(?!\[redacted_secret:)[^\s#'\"]{12,}/g },
];

function preview(value: string): string {
  if (value.length <= 12) return "[redacted]";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function scanSecrets(input: string): SecretScanResult {
  const findings: InternalFinding[] = [];
  for (const def of PATTERNS) {
    for (const match of input.matchAll(def.pattern)) {
      const value = match[0];
      const start = match.index ?? 0;
      findings.push({
        kind: def.kind,
        confidence: def.confidence,
        start,
        end: start + value.length,
        redaction: `[redacted_secret:${def.kind}]`,
        preview: preview(value),
        priority: def.priority,
      });
    }
  }

  findings.sort((a, b) => b.priority - a.priority || a.start - b.start);
  const selected: InternalFinding[] = [];
  for (const finding of findings) {
    if (selected.some((existing) => finding.start < existing.end && finding.end > existing.start)) continue;
    selected.push(finding);
  }
  selected.sort((a, b) => a.start - b.start);
  const publicFindings = selected.map(({ priority: _priority, ...finding }) => finding);

  return {
    findings: publicFindings,
    hasHighConfidenceSecret: publicFindings.some((f) => f.confidence === "high"),
    redacted: redactWithFindings(input, publicFindings),
  };
}

function redactWithFindings(input: string, findings: SecretFinding[]): string {
  if (findings.length === 0) return input;
  let out = "";
  let cursor = 0;
  for (const finding of findings) {
    out += input.slice(cursor, finding.start);
    out += finding.redaction;
    cursor = finding.end;
  }
  out += input.slice(cursor);
  return out;
}

export function redactSecrets(input: string): string {
  return scanSecrets(input).redacted;
}

export function shouldBlockPersistence(result: SecretScanResult, policy: SecretScanPolicy = DEFAULT_SECRET_SCAN_POLICY): boolean {
  return policy.blockHighConfidence && result.hasHighConfidenceSecret;
}

export function redactSecretsInObject(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((entry) => redactSecretsInObject(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, redactSecretsInObject(nested)]));
  }
  return value;
}
