import { readFileSync } from "node:fs";
import { appendCandidate } from "./inbox";
import type { CaptureCandidate } from "./types";

export interface ImportLegacyOptions { now: string }
export interface ImportLegacyQuality { highConfidence: number; mediumConfidence: number; lowConfidence: number }
export interface ImportLegacyResult { imported: number; candidates: CaptureCandidate[]; quality: ImportLegacyQuality }

function tagsFromBlock(block: string): string[] {
  return [...block.matchAll(/#([a-zA-Z0-9-]+)/g)].map((match) => match[1]);
}

function candidateId(index: number, now: string): string {
  const stamp = now.replace(/[-:T.Z]/g, "").slice(0, 14);
  return `legacy_${stamp}_${String(index + 1).padStart(3, "0")}`;
}

function confidenceFromBlock(block: string): number {
  let score = 0.62;
  if (/\*\*Confidence\*\*\s*:/i.test(block)) {
    const match = block.match(/\*\*Confidence\*\*\s*:\s*([0-9.]+)/i);
    if (match) score = Math.min(0.95, Math.max(score, Number(match[1])));
  }
  const evidenceRefs = evidenceRefsFromBlock(block);
  if (evidenceRefs.length >= 1) score += 0.06;
  if (evidenceRefs.length >= 2) score += 0.03;
  if (/\*\*Change condition\*\*\s*:/i.test(block)) score += 0.08;
  if (/\*\*Stability\*\*\s*:/i.test(block)) score += 0.03;
  if (/\*\*Review\*\*\s*:/i.test(block) || /\|\s*\*\*Review\*\*\s*:/i.test(block)) score += 0.02;
  if (block.trim().split(/\s+/).length < 8) score -= 0.08;
  return Math.min(0.95, Math.max(0.45, Number(score.toFixed(2))));
}

function evidenceRefsFromBlock(block: string): string[] {
  const match = block.match(/\*\*Evidence\*\*\s*:\s*(.+)/i);
  if (!match) return [];
  return match[1]
    .split(/[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function qualityFromCandidates(candidates: CaptureCandidate[]): ImportLegacyQuality {
  return candidates.reduce<ImportLegacyQuality>((quality, candidate) => {
    const confidence = candidate.confidence ?? 0;
    if (confidence >= 0.85) quality.highConfidence += 1;
    else if (confidence >= 0.7) quality.mediumConfidence += 1;
    else quality.lowConfidence += 1;
    return quality;
  }, { highConfidence: 0, mediumConfidence: 0, lowConfidence: 0 });
}

export function importLegacyMemoryMarkdown(root: string, legacyFile: string, options: ImportLegacyOptions): ImportLegacyResult {
  const text = readFileSync(legacyFile, "utf-8");
  const matches = [...text.matchAll(/^###\s+(.+)$([\s\S]*?)(?=^###\s+|$(?![\s\S]))/gm)];
  const candidates = matches.map((match, index): CaptureCandidate => {
    const title = match[1].trim();
    const body = match[2].trim();
    return {
      id: candidateId(index, options.now),
      created_at: options.now,
      source: { type: "legacy-memory", ref: legacyFile },
      text: `${title}\n\n${body}`.trim(),
      tags: [...new Set(tagsFromBlock(body))],
      evidence_refs: [...new Set([legacyFile, ...evidenceRefsFromBlock(body)])],
      confidence: confidenceFromBlock(body),
      status: "new",
    };
  });
  for (const candidate of candidates) appendCandidate(root, candidate);
  return { imported: candidates.length, candidates, quality: qualityFromCandidates(candidates) };
}
