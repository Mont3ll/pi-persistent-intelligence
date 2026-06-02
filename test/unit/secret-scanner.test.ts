import { describe, expect, test } from "bun:test";
import { scanSecrets, redactSecrets, redactSecretsInObject, shouldBlockPersistence } from "../../src/secret-scanner";

describe("secret scanner", () => {
  test("detects high-confidence OpenAI-style key", () => {
    const result = scanSecrets("OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(result.findings.some((f) => f.kind === "openai_api_key" && f.confidence === "high")).toBe(true);
    expect(result.hasHighConfidenceSecret).toBe(true);
  });

  test("detects GitHub token", () => {
    const result = scanSecrets("token ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD");
    expect(result.findings.some((f) => f.kind === "github_token")).toBe(true);
  });

  test("detects AWS access key", () => {
    const result = scanSecrets("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
    expect(result.findings.some((f) => f.kind === "aws_access_key")).toBe(true);
  });

  test("detects private key block", () => {
    const result = scanSecrets("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----");
    expect(result.findings.some((f) => f.kind === "ssh_private_key")).toBe(true);
  });

  test("detects bearer token", () => {
    const result = scanSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ");
    expect(result.findings.some((f) => f.kind === "bearer_token")).toBe(true);
  });

  test("detects env style secret", () => {
    const result = scanSecrets("DATABASE_PASSWORD=super-secret-password-value");
    expect(result.findings.some((f) => f.kind === "env_secret")).toBe(true);
  });

  test("does not flag normal code or prose", () => {
    const result = scanSecrets("Use bun test before typecheck and keep JSONL canonical.");
    expect(result.findings).toHaveLength(0);
    expect(shouldBlockPersistence(result)).toBe(false);
  });

  test("redacts raw secret values", () => {
    const input = "ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    const redacted = redactSecrets(input);
    expect(redacted).toContain("[redacted_secret:github_token]");
    expect(redacted).not.toContain(input);
  });

  test("redacts nested objects", () => {
    const input = { text: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ", keep: "safe" };
    const redacted = redactSecretsInObject(input) as typeof input;
    expect(redacted.text).toContain("[redacted_secret:bearer_token]");
    expect(redacted.keep).toBe("safe");
  });
});
