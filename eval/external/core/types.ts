export type BenchmarkName = "ama-bench" | "longmemeval-v2" | "memoryarena";
export type BenchmarkPreset = "contract" | "smoke" | "pilot" | "full";
export type BenchmarkTrack = "production" | "diagnostic";
export type ModelRole = "reader" | "judge" | "embedding" | "controller";

export interface BenchmarkManifest {
  schemaVersion: 1;
  benchmark: BenchmarkName;
  preset: BenchmarkPreset;
  tracks: BenchmarkTrack[];
  pi: { commit: string; clean: boolean; sourceHash: string };
  upstream: { url: string; commit: string };
  dataset: { url: string; revision: string; files: Array<{ path: string; sha256: string }> };
  cases: string[];
  models: Array<{ role: ModelRole; id: string; provider: string; baseUrl?: string }>;
  promptHashes: Record<string, string>;
  context: { maxTokens: number; maxRecords: number };
  curationPolicy: "pi-default-high-only-v1";
  seeds: number[];
  retry: { maxAttempts: number; baseDelayMs: number };
  environment: { bun: string; python: string; platform: string };
  expected: { cases: number; modelCalls: number; estimatedCostUsd: number | null };
  outputRoot: string;
}

export interface BenchmarkApproval {
  schemaVersion: 1;
  manifestFingerprint: string;
  approvedAt: string;
  mode: "explicit";
}

export interface BenchmarkVerification {
  schemaVersion: 1;
  runFingerprint: string;
  verified: boolean;
  publishable: boolean;
  completedCases: number;
  expectedCases: number;
  findings: Array<{ severity: "error" | "warning"; code: string; message: string }>;
  artifactHashes: Record<string, string>;
}
