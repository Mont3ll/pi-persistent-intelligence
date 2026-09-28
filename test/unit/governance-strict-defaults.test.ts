import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, loadConfig, writeDefaultConfig } from "../../src/config";
import { ensureMemoryDirs, resolvePaths } from "../../src/paths";

let roots: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-k6-strict-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  roots = [];
});

function storeMetadataPath(dir: string): string | undefined {
  return ((resolvePaths(dir).governance as unknown) as { storeMetadata?: string }).storeMetadata;
}

describe("K6 strict governance defaults", () => {
  test("global defaults are strict for new stores", () => {
    expect(defaultConfig.governance.mode).toBe("strict");
  });

  test("governance paths expose durable store-origin metadata", () => {
    const dir = root();
    expect(storeMetadataPath(dir)).toBe(join(dir, "governance", "store-metadata.json"));
  });

  test("a genuinely new store remains strict even when directories are materialized before config load", () => {
    const dir = root();
    ensureMemoryDirs(dir);

    expect(loadConfig(dir).governance.mode).toBe("strict");

    const marker = join(dir, "governance", "store-metadata.json");
    expect(existsSync(marker)).toBe(true);
    const metadata = JSON.parse(readFileSync(marker, "utf8")) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      schema_version: 1,
      origin: "new",
      default_governance_mode: "strict",
    });
  });

  test("a pre-existing store without config remains compatibility for migration", () => {
    const dir = root();
    mkdirSync(join(dir, "memory"), { recursive: true });
    writeFileSync(join(dir, "memory", "L2.playbooks.jsonl"), "", "utf8");

    expect(loadConfig(dir).governance.mode).toBe("compatibility");

    const marker = join(dir, "governance", "store-metadata.json");
    expect(existsSync(marker)).toBe(true);
    const metadata = JSON.parse(readFileSync(marker, "utf8")) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      schema_version: 1,
      origin: "legacy",
      default_governance_mode: "compatibility",
    });
  });

  test("legacy config lacking a governance field stays compatibility instead of inheriting the new strict default", () => {
    const dir = root();
    writeFileSync(join(dir, "config.json"), JSON.stringify({
      curator: { minConfidence: 0.8 },
    }), "utf8");

    expect(loadConfig(dir).governance.mode).toBe("compatibility");
  });

  test("explicit compatibility and strict settings remain authoritative", () => {
    const compatibility = root();
    writeFileSync(join(compatibility, "config.json"), JSON.stringify({ governance: { mode: "compatibility" } }), "utf8");
    expect(loadConfig(compatibility).governance.mode).toBe("compatibility");

    const strict = root();
    writeFileSync(join(strict, "config.json"), JSON.stringify({ governance: { mode: "strict" } }), "utf8");
    expect(loadConfig(strict).governance.mode).toBe("strict");
  });

  test("writing a default config for a new store persists strict mode", () => {
    const dir = root();
    ensureMemoryDirs(dir);
    const file = writeDefaultConfig(dir);
    const written = JSON.parse(readFileSync(file, "utf8")) as { governance?: { mode?: string } };

    expect(written.governance?.mode).toBe("strict");
    expect(loadConfig(dir).governance.mode).toBe("strict");
  });
});
