/**
 * Read-only R4 semantic model experiment.
 *
 * Usage:
 * PI_R4_MODEL_BIN=/absolute/path/to/command \
 * PI_R4_MODEL_ARGS='["--model","your-model"]' \
 * bun scripts/r4-semantic-evaluate.ts /path/to/privacy-reviewed-labelled.jsonl
 *
 * Input rows: { id, sessionId, turnId, text, expected: "durable" |
 * "temporary" | "not_memory" | "uncertain" }.
 *
 * Does not write files or emit private source text. These are model *proposal*
 * metrics, not an end-to-end governed auto-apply safety claim.
 */
import { readFileSync } from "node:fs";
import { commandSemanticAdapter } from "../src/semantic-assessment-command";
import { proposeSemanticReview, type SemanticReview, type Disposition } from "../src/semantic-assessment";

type Label = Disposition;
const validLabels: readonly string[] = ["durable", "temporary", "not_memory", "uncertain"];
const input = process.argv[2];
const executable = process.env.PI_R4_MODEL_BIN;
if (!input || !executable) throw new Error("Supply labelled JSONL path and PI_R4_MODEL_BIN");
// Bun may include offending input in native JSON.parse error messages.
function parseUntrustedJson(serialized: string): unknown {
  try { return JSON.parse(serialized) as unknown; }
  catch { throw new Error("invalid_semantic_eval_json"); }
}
const args = process.env.PI_R4_MODEL_ARGS ? parseUntrustedJson(process.env.PI_R4_MODEL_ARGS) : [];
if (!Array.isArray(args) || !args.every(v => typeof v === "string")) throw new Error("Invalid model args");
const adapter = commandSemanticAdapter(executable, args);

const raw = readFileSync(input, "utf8");
if (raw.length > 2_000_000) throw new Error("Labelled file too large");
const rows: unknown[] = raw.split(/\r?\n/).filter(Boolean).map(row => parseUntrustedJson(row));
if (rows.length === 0 || rows.length > 500) throw new Error("Require 1-500 labelled rows");

function label(result: SemanticReview): Label {
  if (result.status !== "proposal_only") return "uncertain";
  const ps = result.result.propositions;
  if (ps.some(p => p.disposition === "uncertain")) return "uncertain";
  if (ps.length === 1 && ps[0]!.disposition === "durable"
    && ps[0]!.endorsement === "direct_user"
    && ps[0]!.duration === "standing" && ps[0]!.scope === "project") return "durable";
  if (ps.every(p => p.disposition === "temporary" || p.duration === "bounded")) return "temporary";
  if (ps.every(p => p.disposition === "not_memory")) return "not_memory";
  return "uncertain";
}
const counts: Record<string, number> = {};
let predictedDurable = 0, falseDurable = 0, falseHolds = 0, abstentions = 0;
for (const unknownRow of rows) {
  if (!unknownRow || typeof unknownRow !== "object" || Array.isArray(unknownRow)) throw new Error("Invalid row");
  const row = unknownRow as Record<string, unknown>;
  if (![row.id, row.sessionId, row.turnId, row.text].every(v => typeof v === "string" && v.length > 0)
    || typeof row.text !== "string" || row.text.length > 32_000
    || !validLabels.includes(row.expected as string)) throw new Error("Invalid row fields");
  const result = await proposeSemanticReview({
    sessionId: row.sessionId as string, turnId: row.turnId as string, text: row.text,
  }, adapter);
  const actual = label(result), expected = row.expected as Label;
  counts[expected + ":" + actual] = (counts[expected + ":" + actual] ?? 0) + 1;
  if (result.status === "abstain") abstentions++;
  if (actual === "durable") predictedDurable++;
  if (actual === "durable" && expected !== "durable") falseDurable++;
  if (actual !== "durable" && expected === "durable") falseHolds++;
}
process.stdout.write(JSON.stringify({
  rows: rows.length, modelProposalOnly: true, actualWrites: 0, predictedDurable,
  unsafeDurablePredictions: falseDurable, missedDurablePredictions: falseHolds,
  abstentions, confusion: counts,
}, null, 2) + "\n");
