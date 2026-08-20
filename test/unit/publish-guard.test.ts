import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function loadPublishGuard() {
  try {
    return await import("../../scripts/publish-guard");
  } catch {
    return undefined;
  }
}

describe("publish workflow guard", () => {
  test("requires the pushed tag to match the package version", async () => {
    const guard = await loadPublishGuard();
    expect(guard).toBeDefined();
    expect(guard?.validatePublishTag("v0.15.1", "0.15.1")).toBeUndefined();
    expect(() => guard?.validatePublishTag("v0.15.0", "0.15.1")).toThrow(
      "Pushed tag v0.15.0 does not match package version 0.15.1",
    );
  });

  test("classifies duplicate versions separately from operational failures", async () => {
    const guard = await loadPublishGuard();
    expect(guard).toBeDefined();

    expect(guard?.classifyNpmFailure("npm error code EPUBLISHCONFLICT")).toBe("duplicate");
    expect(guard?.classifyNpmFailure("npm error code E401 Incorrect or missing password")).toBe("authentication");
    expect(guard?.classifyNpmFailure("npm error code ENEEDAUTH login required")).toBe("authentication");
    expect(guard?.classifyNpmFailure("npm error code EOTP one-time password required")).toBe("authentication");
    expect(guard?.classifyNpmFailure("npm error code E403 You do not have permission")).toBe("permission");
    expect(guard?.classifyNpmFailure("npm error code ENETWORK request failed")).toBe("network");
    expect(guard?.classifyNpmFailure("npm error code ENOTFOUND registry.npmjs.org")).toBe("network");
    expect(guard?.classifyNpmFailure("npm error code EAI_AGAIN registry.npmjs.org")).toBe("network");
    expect(guard?.classifyNpmFailure("npm error code E404 Not Found")).toBe("not-found");
    expect(guard?.classifyNpmFailure("npm error code E500 registry unavailable")).toBe("other");
  });

  test("fails closed for every publish error except a duplicate version", async () => {
    const guard = await loadPublishGuard();
    expect(guard).toBeDefined();

    expect(guard?.publishFailureExitCode("duplicate")).toBe(0);
    expect(guard?.publishFailureExitCode("authentication")).toBe(1);
    expect(guard?.publishFailureExitCode("permission")).toBe(1);
    expect(guard?.publishFailureExitCode("network")).toBe(1);
    expect(guard?.publishFailureExitCode("other")).toBe(1);
  });

  test("skips an already published version without invoking publish", async () => {
    const guard = await loadPublishGuard();
    expect(guard).toBeDefined();
    const calls: string[][] = [];
    const result = await guard?.runGuardedPublish({
      packageName: "example-package",
      version: "1.2.3",
      publishArgs: ["--access", "public"],
      runCommand: async (args: string[]) => {
        calls.push(args);
        return { exitCode: 0, stdout: '"1.2.3"', stderr: "" };
      },
    });

    expect(result).toEqual({ status: "duplicate", exitCode: 0 });
    expect(calls).toEqual([["view", "example-package@1.2.3", "version", "--json"]]);
  });

  test("publishes only after a not-found preflight", async () => {
    const guard = await loadPublishGuard();
    expect(guard).toBeDefined();
    const calls: string[][] = [];
    const result = await guard?.runGuardedPublish({
      packageName: "example-package",
      version: "1.2.3",
      publishArgs: ["--provenance"],
      runCommand: async (args: string[]) => {
        calls.push(args);
        if (args[0] === "view") {
          return { exitCode: 1, stdout: "", stderr: "npm error code E404 Not Found" };
        }
        return { exitCode: 0, stdout: "+ example-package@1.2.3", stderr: "" };
      },
    });

    expect(result).toEqual({ status: "published", exitCode: 0 });
    expect(calls).toEqual([
      ["view", "example-package@1.2.3", "version", "--json"],
      ["publish", "--provenance"],
    ]);
  });

  test("fails closed when preflight cannot authenticate", async () => {
    const guard = await loadPublishGuard();
    expect(guard).toBeDefined();
    const calls: string[][] = [];
    const result = await guard?.runGuardedPublish({
      packageName: "example-package",
      version: "1.2.3",
      publishArgs: [],
      runCommand: async (args: string[]) => {
        calls.push(args);
        return { exitCode: 1, stdout: "", stderr: "npm error code E401 Incorrect or missing password" };
      },
    });

    expect(result).toEqual({
      status: "authentication",
      exitCode: 1,
      diagnostic: "npm error code E401 Incorrect or missing password",
    });
    expect(calls).toHaveLength(1);
  });

  test("accepts only duplicate publish races and rejects permission failures", async () => {
    const guard = await loadPublishGuard();
    expect(guard).toBeDefined();
    const outcomes = [
      { stderr: "npm error code EPUBLISHCONFLICT", expected: { status: "duplicate", exitCode: 0 } },
      {
        stderr: "npm error code E403 You do not have permission",
        expected: {
          status: "permission",
          exitCode: 1,
          diagnostic: "npm error code E403 You do not have permission",
        },
      },
    ] as const;

    for (const outcome of outcomes) {
      const result = await guard?.runGuardedPublish({
        packageName: "example-package",
        version: "1.2.3",
        publishArgs: [],
        runCommand: async (args: string[]) =>
          args[0] === "view"
            ? { exitCode: 1, stdout: "", stderr: "npm error code E404 Not Found" }
            : { exitCode: 1, stdout: "", stderr: outcome.stderr },
      });
      expect(result).toEqual(outcome.expected);
    }
  });

  test("redacts and bounds actionable npm diagnostics", async () => {
    const guard = await loadPublishGuard();
    expect(guard).toBeDefined();
    const token = `gh${"p"}_${"a".repeat(40)}`;
    const diagnostic = guard?.formatNpmDiagnostic(`npm error authentication failed ${token}\n${"x".repeat(2500)}`);

    expect(diagnostic).toContain("npm error authentication failed [redacted_secret:github_token]");
    expect(diagnostic?.length).toBeLessThanOrEqual(2000);
  });

  test("workflow invokes the guard and has no broad continue-on-error", () => {
    const workflow = readFileSync(join(import.meta.dir, "../../.github/workflows/publish.yml"), "utf8");

    expect(workflow).toContain("bun scripts/publish-guard.ts verify-tag");
    expect(workflow).toContain("bun scripts/publish-guard.ts publish");
    expect(workflow).not.toContain("continue-on-error: true");
  });
});
