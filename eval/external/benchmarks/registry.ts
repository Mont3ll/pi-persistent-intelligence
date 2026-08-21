import { amaBenchAdapter } from "./ama-bench";
import { longMemEvalV2Adapter } from "./longmemeval-v2";
import { memoryArenaAdapter } from "./memoryarena";
import type { ExternalBenchmarkAdapter } from "./adapter-support";
const adapters = new Map([amaBenchAdapter, longMemEvalV2Adapter, memoryArenaAdapter].map((adapter) => [adapter.name, adapter]));
export function getBenchmarkAdapter(name: string): ExternalBenchmarkAdapter { const adapter = adapters.get(name as never); if (!adapter) throw new Error(`unknown external benchmark: ${name}`); return adapter; }
export type { ExternalBenchmarkAdapter, PrepareInput, SanitizedCase, OfficialMetrics } from "./adapter-support";
