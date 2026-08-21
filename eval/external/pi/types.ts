import type { BenchmarkHistoryItem, BenchmarkQuery, TrackConfig } from "../core/protocol";
import type { BenchmarkTrack } from "../core/types";

export interface TrackInsertTrace {
  caseId: string;
  track: BenchmarkTrack;
  historyIds: string[];
  candidateIds: string[];
  candidatesCreated: number;
  proposedOperationIds: string[];
  appliedOperationIds: string[];
  patchId?: string;
}
export interface TrackQueryResult {
  context: string;
  selectedIds: string[];
  diagnostic: boolean;
  trace: { candidateIds: string[]; processorExclusions: string[]; injectedChars: number };
}
export interface BenchmarkTrackRunner {
  insert(caseId: string, items: BenchmarkHistoryItem[]): Promise<TrackInsertTrace>;
  query(caseId: string, query: BenchmarkQuery): Promise<TrackQueryResult>;
  close(caseId: string): Promise<void>;
}
export type BenchmarkTrackConfig = TrackConfig;
