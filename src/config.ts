import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureMemoryDirs } from "./paths";

export interface PiMemoryConfig {
  qmd: { collection: string; enabled: boolean };
  curator: {
    minConfidence: number;
    minEvidenceCount: number;
    mode: "propose" | "supervised" | "auto";
    /**
     * Tiered auto-curation at session end.
     *
     * "off"          — never auto-curate (pure manual, original behaviour)
     * "high-only"    — auto-apply ops where confidence >= autoCurateHighThreshold
     *                  and not L1 / supersede (default, recommended)
     * "all-eligible" — auto-apply every default_selected non-high-risk op
     *                  (matches pi-memory behaviour; less governance)
     */
    autoCurate: "off" | "high-only" | "all-eligible";
    /** Confidence floor for "high-only" auto-apply (default 0.85) */
    autoCurateHighThreshold: number;
    /**
     * Minimum pending inbox candidates before the review overlay appears.
     * Set to 0 to always show, or 999 to disable. Default: 3.
     */
    inboxPromptThreshold: number;
  };
  maintainer: { semiStableDecay: number; stableDecay: number; mode: "propose" | "supervised" | "auto" };
  llm: { enabled: boolean; model: string | null; instructions?: string; command?: string | null };
  vault: { enabled: boolean; path: string | null; reportOnly: boolean };
}

export const defaultConfig: PiMemoryConfig = {
  qmd: { collection: "pi-persistent-intelligence", enabled: true },
  curator: {
    minConfidence: 0.75,
    minEvidenceCount: 2,
    mode: "propose",
    autoCurate: "high-only",         // smart default: auto-promote confident L2, protect L1
    autoCurateHighThreshold: 0.85,
    inboxPromptThreshold: 3,         // show overlay when >= 3 candidates pending
  },
  maintainer: { semiStableDecay: 0.15, stableDecay: 0.05, mode: "propose" },
  llm: { enabled: false, model: null, command: null },
  vault: { enabled: false, path: null, reportOnly: true },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function mergeConfig(base: PiMemoryConfig, override: DeepPartial<PiMemoryConfig>): PiMemoryConfig {
  return {
    qmd: { ...base.qmd, ...(override.qmd ?? {}) },
    curator: { ...base.curator, ...(override.curator ?? {}) },
    maintainer: { ...base.maintainer, ...(override.maintainer ?? {}) },
    llm: { ...base.llm, ...(override.llm ?? {}) },
    vault: { ...base.vault, ...(override.vault ?? {}) },
  };
}

export function loadConfig(root: string): PiMemoryConfig {
  const paths = ensureMemoryDirs(root);
  if (!existsSync(paths.config)) return defaultConfig;
  try {
    const parsed = JSON.parse(readFileSync(paths.config, "utf-8")) as DeepPartial<PiMemoryConfig>;
    return mergeConfig(defaultConfig, parsed);
  } catch {
    return defaultConfig;
  }
}

export function writeDefaultConfig(root: string): string {
  const paths = ensureMemoryDirs(root);
  if (!existsSync(paths.config)) writeFileSync(paths.config, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf-8");
  return paths.config;
}
