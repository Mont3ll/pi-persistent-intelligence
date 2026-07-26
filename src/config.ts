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
  governance: { mode: "compatibility" | "strict" };
  piGovernance: { enabled: boolean; mode: "external"; command: string | null; store: string | null; namespace: string };
  retrieval: { injectionMode: "scoped" | "policy_only" | "wakeup"; maxRecords?: number; maxL1Records?: number; maxL2Records?: number };
  inquiries: { reviewWindowDays: number };
  reinforcement: { neutralExposureEnabled: boolean };
  capture: {
    activityRetentionCount: number;
    activityRetentionDays: number;
    singletonDirectReview: boolean;
    checkpointEveryTurn: boolean;
    implicitConsolidationTurnInterval: number;
  };
  metaConsolidation: {
    enabled: boolean;
    cadence: "manual" | "weekly" | "monthly";
    min_l2_records: number;
    min_reinforcement_score: number;
    max_candidates_per_run: number;
    max_input_records: number;
    require_counterexample_search: boolean;
  };
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
  governance: { mode: "compatibility" as const },
  piGovernance: { enabled: false, mode: "external" as const, command: null, store: null, namespace: "default" },
  retrieval: { injectionMode: "scoped" as const },
  inquiries: { reviewWindowDays: 30 },
  reinforcement: { neutralExposureEnabled: false },
  capture: {
    activityRetentionCount: 500,
    activityRetentionDays: 30,
    singletonDirectReview: true,
    checkpointEveryTurn: true,
    implicitConsolidationTurnInterval: 20,
  },
  metaConsolidation: {
    enabled: false,
    cadence: "manual" as const,
    min_l2_records: 2,
    min_reinforcement_score: 0,
    max_candidates_per_run: 5,
    max_input_records: 50,
    require_counterexample_search: true,
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function mergeConfig(base: PiMemoryConfig, override: DeepPartial<PiMemoryConfig>): PiMemoryConfig {
  return {
    qmd: { ...base.qmd, ...(override.qmd ?? {}) },
    curator: { ...base.curator, ...(override.curator ?? {}) },
    maintainer: { ...base.maintainer, ...(override.maintainer ?? {}) },
    llm: { ...base.llm, ...(override.llm ?? {}) },
    vault: { ...base.vault, ...(override.vault ?? {}) },
    governance: { ...base.governance, ...(override.governance ?? {}) },
    piGovernance: { ...base.piGovernance, ...(override.piGovernance ?? {}) },
    retrieval: { ...base.retrieval, ...(override.retrieval ?? {}) },
    inquiries: { ...base.inquiries, ...(override.inquiries ?? {}) },
    reinforcement: { ...base.reinforcement, ...(override.reinforcement ?? {}) },
    capture: { ...base.capture, ...(override.capture ?? {}) },
    metaConsolidation: { ...base.metaConsolidation, ...(override.metaConsolidation ?? {}) },
  };
}

export function loadConfig(root: string): PiMemoryConfig {
  const paths = ensureMemoryDirs(root);
  if (!existsSync(paths.config)) return defaultConfig;
  try {
    const parsed = JSON.parse(readFileSync(paths.config, "utf-8")) as DeepPartial<PiMemoryConfig>;
    const merged = mergeConfig(defaultConfig, parsed);
    if (!Number.isInteger(merged.inquiries.reviewWindowDays) || merged.inquiries.reviewWindowDays < 1 || merged.inquiries.reviewWindowDays > 3650) {
      merged.inquiries.reviewWindowDays = defaultConfig.inquiries.reviewWindowDays;
    }
    if (!Number.isInteger(merged.capture.activityRetentionCount) || merged.capture.activityRetentionCount < 10 || merged.capture.activityRetentionCount > 10000) merged.capture.activityRetentionCount = defaultConfig.capture.activityRetentionCount;
    if (!Number.isInteger(merged.capture.activityRetentionDays) || merged.capture.activityRetentionDays < 1 || merged.capture.activityRetentionDays > 365) merged.capture.activityRetentionDays = defaultConfig.capture.activityRetentionDays;
    if (!Number.isInteger(merged.capture.implicitConsolidationTurnInterval) || merged.capture.implicitConsolidationTurnInterval < 3 || merged.capture.implicitConsolidationTurnInterval > 200) merged.capture.implicitConsolidationTurnInterval = defaultConfig.capture.implicitConsolidationTurnInterval;
    return merged;
  } catch {
    return defaultConfig;
  }
}

export function writeDefaultConfig(root: string): string {
  const paths = ensureMemoryDirs(root);
  if (!existsSync(paths.config)) writeFileSync(paths.config, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf-8");
  return paths.config;
}
