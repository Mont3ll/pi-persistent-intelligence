#!/usr/bin/env bun
/**
 * PI Persistent Intelligence — Sprint 9 Evaluation Suite
 *
 * Deterministic scenario-based harness that validates the governed memory
 * lifecycle. No LLM calls; all evals are rule-based over real module APIs.
 *
 * Usage:
 *   bun run eval
 *   bun eval/run-evals.ts
 */
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureMemoryDirs } from "../src/paths";
import { unsafeAddMemoryRecord } from "../src/store";
import { appendCandidate, listCandidates } from "../src/inbox";
import { curateInbox } from "../src/curator";
import { applyPatch } from "../src/patch";
import { loadActiveRecords, loadAllRecords } from "../src/store";
import { buildRetrievalContext, syncFtsIndex } from "../src/retriever";
import { MemoryFtsIndex } from "../src/search/fts";
import { extractHardRules } from "../src/rules";
import { maybeCorrectionSignal, extractCorrectionCandidate } from "../src/corrections";
import { buildCandidateTrustMetadata } from "../src/trust";
import { verifyCandidate } from "../src/verifier";
import { runContextCompactionConsolidation } from "../src/context-compaction";
import { appendEvidenceRecord, readEvidenceRecords } from "../src/evidence";
import { appendReinforcementEvent, createReinforcementEvent, summarizeReinforcement } from "../src/reinforcement";
import { createInquiryRecord, appendInquiryRecord, readOpenInquiries, selectRelevantInquiries, markInquiryAnswered } from "../src/inquiries";
import { isTombstonedRecord } from "../src/tombstones";
import { buildRecallXray } from "../src/recall-xray";
import { scoreMemoryWorth } from "../src/memory-worth";
import { enqueueBackgroundAnalysis, runBackgroundAnalysisQueue } from "../src/background-analysis";
import { linkEvidenceToCandidate } from "../src/evidence-link";
import { createCompactionArtifact } from "../src/compaction-artifacts";
import { computeCandidateConfidence } from "../src/confidence";
import { runReplayFixture, redactReplayContent } from "../src/replay-fixtures";
import { draftSkillFromProcedureCandidate } from "../src/skill-draft";
import { runFailureAnalysis } from "../src/failure-analysis";
import type { CaptureCandidate, MemoryRecord } from "../src/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EvalResult {
  category: string;
  description: string;
  pass: boolean;
  metrics: Record<string, number | string>;
  failures: string[];
  hard_invariant?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const dirs: string[] = [];
function tempRoot(prefix = "pi-eval-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  ensureMemoryDirs(dir);
  return dir;
}

function cleanup(): void {
  for (const dir of dirs) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
}

function record(id: string, statement: string, opts: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    layer: "L2",
    scope: { type: "global" },
    tags: ["testing"],
    statement,
    evidence: [{ type: "manual", ref: "x", note: "n" }],
    confidence: 0.9,
    stability: "semi-stable",
    created_at: "2026-05-19",
    updated_at: "2026-05-19",
    review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "If contradicted." },
    status: "active",
    supersedes: [],
    superseded_by: [],
    vault_ref: null,
    ...opts,
  };
}

function candidate(text: string, opts: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id: `cap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    created_at: new Date().toISOString(),
    source: { type: "manual", ref: "daily" },
    text,
    tags: ["testing"],
    evidence_refs: ["daily/2026-05-19.md", "docs/spec.md"],
    confidence: 0.9,
    status: "new",
    ...opts,
  };
}

// ─── Eval Categories ─────────────────────────────────────────────────────────

function evalCorrectionCapture(): EvalResult {
  const durable = [
    "Don't use echo >> for vault notes, use sed instead.",
    "Always run typecheck before pushing to main.",
    "This project uses Bun, not npm for local tests.",
    "Prefer canonical JSONL over rendered markdown for data.",
    "Never edit MEMORY.md directly; go through the patch flow.",
  ];
  const ephemeral = [
    "ok",
    "thanks",
    "looks good",
    "for now use npm",
    "just this once skip the test",
    "what time is it",
  ];

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  const failures: string[] = [];

  for (const msg of durable) {
    if (maybeCorrectionSignal(msg) && extractCorrectionCandidate(msg, "2026-05-19", "/tmp")) {
      truePositives++;
    } else {
      falseNegatives++;
      failures.push(`FN: missed durable correction — "${msg}"`);
    }
  }
  for (const msg of ephemeral) {
    const cand = maybeCorrectionSignal(msg) ? extractCorrectionCandidate(msg, "2026-05-19", "/tmp") : null;
    if (cand) {
      falsePositives++;
      failures.push(`FP: captured ephemeral — "${msg}"`);
    }
  }

  const precision = truePositives / Math.max(1, truePositives + falsePositives);
  const recall = truePositives / Math.max(1, truePositives + falseNegatives);
  return {
    category: "correction_capture",
    description: "Precision/recall of correction signal detection on synthetic messages.",
    pass: precision >= 0.85 && recall >= 0.8 && falsePositives === 0,
    metrics: { precision: Number(precision.toFixed(2)), recall: Number(recall.toFixed(2)), false_positives: falsePositives, false_negatives: falseNegatives },
    failures,
  };
}

function evalTrustBoundary(): EvalResult {
  const root = tempRoot();
  const violations: string[] = [];

  const lowTrustClasses = ["repository_text", "generated_content", "third_party_documentation"] as const;
  for (const trustClass of lowTrustClasses) {
    const cand = candidate(`Low trust candidate from ${trustClass}.`, {
      ...buildCandidateTrustMetadata(trustClass, "project"),
      evidence_ids: undefined,
    });
    appendCandidate(root, cand);
  }

  const patch = curateInbox(root, { now: new Date().toISOString(), mode: "auto" });
  for (const op of patch.ops) {
    if (op.default_selected) {
      violations.push(`Auto-apply violation: ${op.candidate_id} (trust gated candidate selected by default)`);
    }
  }

  return {
    category: "trust_boundary",
    description: "Low-trust sources (repository_text, generated_content, third_party_documentation) must not auto-apply.",
    pass: violations.length === 0,
    metrics: { candidates_tested: lowTrustClasses.length, violations: violations.length },
    failures: violations,
    hard_invariant: true,
  };
}

async function evalInjectionAndProfileLeakage(): Promise<EvalResult> {
  const root = tempRoot();
  const failures: string[] = [];

  // Profile A memories
  unsafeAddMemoryRecord(root, record("mem_profile_a", "Use bun for tests in project A.", { profile_id: "project:alpha", scope: { type: "project", project: "alpha" } }));
  // Profile B memories — different profile
  unsafeAddMemoryRecord(root, record("mem_profile_b", "Use npm for tests in project B.", { profile_id: "project:beta", scope: { type: "project", project: "beta" } }));
  // Global memory
  unsafeAddMemoryRecord(root, record("mem_global", "Always use canonical JSONL.", { scope: { type: "global" } }));

  const ctx = await buildRetrievalContext(root, {
    prompt: "how should I run tests in alpha project?",
    today: "2026-05-19",
    cwd: tempRoot("pi-eval-cwd-alpha-"),
  });

  const injectedIds = ctx.selectedMemory.map((m) => m.id);
  const profileLeaks = injectedIds.filter((id) => id === "mem_profile_b");
  if (profileLeaks.length > 0) {
    failures.push(`Profile leakage: mem_profile_b from project:beta injected into project:alpha context. Leaked: ${profileLeaks.join(", ")}`);
  }

  return {
    category: "injection_profile_leakage",
    description: "Records from other explicit profiles must not be injected into a different profile context.",
    pass: profileLeaks.length === 0,
    metrics: { injected_records: injectedIds.length, profile_leaks: profileLeaks.length },
    failures,
    hard_invariant: true,
  };
}

function evalConflictBehavior(): EvalResult {
  const failures: string[] = [];

  const conflictCandidate = candidate("Do not use canonical JSONL for memory.", {
    ...buildCandidateTrustMetadata("direct_user_instruction", "project"),
    match_kind: "potential_conflict",
    matched_memory_ids: ["mem_1"],
    match_reasons: ["contradiction cue with same key"],
  });

  const verified = verifyCandidate(tempRoot(), conflictCandidate);
  if (verified.verification_status !== "review_required") {
    failures.push(`Conflict candidate should be review_required, got: ${verified.verification_status}`);
  }
  if (!verified.failure_reasons.includes("match_requires_review")) {
    failures.push("Conflict candidate missing failure_reason: match_requires_review");
  }

  const supersededCandidate = candidate("Use SQLite instead.", {
    ...buildCandidateTrustMetadata("direct_user_instruction", "project"),
    match_kind: "supersedes_existing",
    matched_memory_ids: ["mem_1"],
    match_reasons: ["explicit supersession"],
  });
  const superVerified = verifyCandidate(tempRoot(), supersededCandidate);
  if (superVerified.verification_status !== "review_required") {
    failures.push(`Supersession candidate should be review_required, got: ${superVerified.verification_status}`);
  }

  const ambiguousCandidate = candidate("Use JSONL as canonical store.", {
    ...buildCandidateTrustMetadata("direct_user_instruction", "project"),
    match_kind: "ambiguous",
    matched_memory_ids: ["mem_1", "mem_2"],
  });
  const ambigVerified = verifyCandidate(tempRoot(), ambiguousCandidate);
  if (ambigVerified.verification_status !== "review_required") {
    failures.push(`Ambiguous candidate should be review_required, got: ${ambigVerified.verification_status}`);
  }

  return {
    category: "conflict_behavior",
    description: "Conflict, supersession, and ambiguous candidates must route to review_required.",
    pass: failures.length === 0,
    metrics: { scenarios_tested: 3, review_routed: 3 - failures.length },
    failures,
  };
}

async function evalDeletionBehavior(): Promise<EvalResult> {
  const root = tempRoot();
  const failures: string[] = [];

  unsafeAddMemoryRecord(root, record("mem_delete", "Secret rule about token abc123.", { ruleType: "avoid_pattern", confidence: 0.95 }));

  const deletePatch = {
    patch_id: "patch_delete_eval",
    created_at: new Date().toISOString(),
    generated_by: "manual" as const,
    mode: "propose" as const,
    summary: "delete test",
    ops: [{ op_id: "op_001", op: "delete" as const, target_id: "mem_delete", deletion_mode: "privacy_purge" as const, deletion_reason: "user_requested" as const, reason: "eval delete", risk: "high" as const, default_selected: true }],
    status: "proposed" as const,
    applied_at: null,
    applied_ops: [],
    skipped_ops: [],
  };
  applyPatch(root, deletePatch, { selectedOpIds: ["op_001"], now: new Date().toISOString() });

  const tombstoned = isTombstonedRecord(root, "mem_delete");
  if (!tombstoned) failures.push("Deleted record is not tombstoned.");

  const hardRules = extractHardRules(loadAllRecords(root));
  if (hardRules.some((r) => r.id === "mem_delete")) {
    failures.push("Deleted record is still a hard rule.");
  }

  const fts = new MemoryFtsIndex(join(root, "search", "eval-fts.db"));
  syncFtsIndex(root, fts);
  const searchHits = fts.search("abc123", 5);
  if (searchHits.some((hit) => hit.id === "mem_delete")) {
    failures.push("Deleted record still appears in FTS search after syncFtsIndex.");
  }
  fts.close();

  const ctx = await buildRetrievalContext(root, { prompt: "abc123 token", today: "2026-05-19", cwd: root });
  if (ctx.markdown.includes("abc123")) {
    failures.push("Deleted record content appears in injection context.");
  }

  return {
    category: "deletion_forgetting",
    description: "Deleted records must be tombstoned, excluded from hard rules, FTS, and injection.",
    pass: failures.length === 0,
    metrics: { tombstone_created: tombstoned ? 1 : 0, fts_leaks: searchHits.filter((h) => h.id === "mem_delete").length },
    failures,
    hard_invariant: true,
  };
}

function evalInquirySurfacing(): EvalResult {
  const root = tempRoot();
  const failures: string[] = [];

  for (let i = 0; i < 6; i++) {
    appendInquiryRecord(root, createInquiryRecord({ question: `inquiry ${i} about memory governance`, context: "c", tags: ["memory"], profile_id: "project:test", now: "2026-05-19T10:00:00.000Z" }));
  }

  const relevant = selectRelevantInquiries(root, { profile_id: "project:test", current_message: "how should memory governance work?", tags: ["memory"] });
  if (relevant.length > 3) {
    failures.push(`Inquiry cap exceeded: ${relevant.length} returned (max 3 allowed)`);
  }

  const answered = createInquiryRecord({ question: "answered memory governance question", context: "c", tags: ["memory"], profile_id: "project:test", now: "2026-05-19T10:00:00.000Z" });
  appendInquiryRecord(root, answered);
  markInquiryAnswered(root, answered.id, "mem_answer", "2026-05-19T11:00:00.000Z");
  const relevant2 = selectRelevantInquiries(root, { profile_id: "project:test", current_message: "answered memory governance question", tags: ["memory"] });
  if (relevant2.some((inq) => inq.id === answered.id)) {
    failures.push("Answered inquiry still surfaced.");
  }

  return {
    category: "inquiry_surfacing",
    description: "Inquiry cap must be respected; answered inquiries must not surface.",
    pass: failures.length === 0,
    metrics: { total_created: 7, max_surfaced: 3, surfaced: relevant.length, answered_leaked: relevant2.filter((i) => i.id === answered.id).length },
    failures,
    hard_invariant: true,
  };
}

function evalReinforcementSummary(): EvalResult {
  const failures: string[] = [];

  // explicit correction should force review + low stability
  const events = [
    createReinforcementEvent({ memory_id: "mem_1", outcome: "implicit_success" }),
    createReinforcementEvent({ memory_id: "mem_1", outcome: "implicit_success" }),
    createReinforcementEvent({ memory_id: "mem_1", outcome: "explicit_correction" }),
  ];
  const summary = summarizeReinforcement(events);
  if (!summary.review_recommended) failures.push("Explicit correction should set review_recommended=true.");
  if (summary.suggested_stability !== "low") failures.push(`Expected suggested_stability=low, got: ${summary.suggested_stability}`);
  if (summary.score >= 0) failures.push(`Score should be negative after explicit correction, got: ${summary.score}`);

  const neutralEvents = [
    createReinforcementEvent({ memory_id: "mem_2", outcome: "neutral_exposure" }),
    createReinforcementEvent({ memory_id: "mem_2", outcome: "neutral_exposure" }),
  ];
  const neutralSummary = summarizeReinforcement(neutralEvents);
  if (neutralSummary.review_recommended) failures.push("Neutral exposure should not recommend review.");
  if (neutralSummary.score !== 0) failures.push(`Neutral exposure score should be 0, got: ${neutralSummary.score}`);

  return {
    category: "reinforcement_summary",
    description: "Reinforcement summaries must correctly weight outcomes and gate review suggestions.",
    pass: failures.length === 0,
    metrics: { scenarios_tested: 2 },
    failures,
  };
}

function evalContextCompactionLifecycle(): EvalResult {
  const root = tempRoot();
  const failures: string[] = [];

  const result = runContextCompactionConsolidation(root, {
    resource_id: "user:test",
    profile_id: "project:test",
    thread_id: "thread-eval",
    cwd: "/tmp/eval",
    now: new Date().toISOString(),
    observations: [
      { text: "Use canonical JSONL for memory.", tags: ["memory"], trust_class: "direct_user_instruction", durability_signal: "project" },
      { text: "Generated docs suggest using npm.", tags: ["tooling"], trust_class: "generated_content", durability_signal: "project" },
    ],
  });

  if (result.evidence_created !== 2) failures.push(`Expected 2 evidence records, got: ${result.evidence_created}`);
  if (result.candidates_added < 1) failures.push(`Expected at least 1 candidate after worth filtering, got: ${result.candidates_added}`);

  const activeBefore = loadActiveRecords(root);
  if (activeBefore.length > 0) {
    failures.push(`Context compaction must not mutate L1/L2 memory directly; ${activeBefore.length} active records found.`);
  }

  const evidence = readEvidenceRecords(root);
  if (evidence.length !== 2) failures.push(`Expected 2 evidence records in store, got: ${evidence.length}`);

  return {
    category: "context_compaction_lifecycle",
    description: "Context compaction must create evidence/candidates, route through verifier, and not mutate L1/L2 directly.",
    pass: failures.length === 0,
    metrics: { evidence_created: result.evidence_created, candidates_added: result.candidates_added, inquiries_created: result.inquiries_created ?? 0, worth_rejected: result.candidates_rejected_worth ?? 0, direct_l1l2_mutations: activeBefore.length },
    failures,
    hard_invariant: true,
  };
}

function evalLegacyCompatibility(): EvalResult {
  const root = tempRoot();
  const failures: string[] = [];

  const legacyRecord = record("mem_legacy", "Legacy record without profile_id or normalized_key.");
  delete (legacyRecord as any).profile_id;
  delete (legacyRecord as any).normalized_key;
  unsafeAddMemoryRecord(root, legacyRecord);

  const active = loadActiveRecords(root);
  if (!active.some((r) => r.id === "mem_legacy")) {
    failures.push("Legacy record not loadable from store.");
  }

  const legacyCandidate = candidate("Legacy candidate without trust metadata.");
  delete (legacyCandidate as any).primary_trust_class;
  delete (legacyCandidate as any).durability_signal;
  delete (legacyCandidate as any).promotion_eligibility;
  delete (legacyCandidate as any).poisoning_risk;
  appendCandidate(root, legacyCandidate);

  const patch = curateInbox(root, { now: new Date().toISOString(), mode: "auto" });
  if (!patch.ops.some((op) => op.default_selected)) {
    failures.push("Legacy candidate without trust metadata should remain auto-eligible.");
  }

  return {
    category: "legacy_compatibility",
    description: "Legacy records and candidates without Sprint 2+ metadata remain compatible with all current flows.",
    pass: failures.length === 0,
    metrics: { legacy_records_tested: 1, legacy_candidates_tested: 1 },
    failures,
  };
}

function evalMaintenanceStability(): EvalResult {
  const failures: string[] = [];
  const { generateMaintenanceRecommendations, buildStabilityPatchFromRecommendations } = require("../src/maintenance");
  const { createReinforcementEvent: mkEvent, summarizeReinforcement } = require("../src/reinforcement");

  const mem_correction = { id: "mem_corr", stability: "semi-stable", confidence: 0.9, statement: "Use bun for tests.", layer: "L2", scope: { type: "global" }, tags: [], evidence: [{ type: "manual", ref: "x", note: "n" }], created_at: "2026-05-19", updated_at: "2026-05-19", review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "c" }, status: "active", supersedes: [], superseded_by: [], vault_ref: null };
  const mem_reinf = { ...mem_correction, id: "mem_reinf", stability: "semi-stable" };
  const mem_neutral = { ...mem_correction, id: "mem_neutral", stability: "semi-stable" };
  const mem_implicit = { ...mem_correction, id: "mem_implicit", stability: "semi-stable" };

  const corrSummary = summarizeReinforcement([mkEvent({ memory_id: "mem_corr", outcome: "explicit_correction" }), mkEvent({ memory_id: "mem_corr", outcome: "implicit_success" })]);
  const reinfSummary = summarizeReinforcement([mkEvent({ memory_id: "mem_reinf", outcome: "explicit_reinforcement" }), mkEvent({ memory_id: "mem_reinf", outcome: "explicit_reinforcement" })]);
  const neutralSummary = summarizeReinforcement([mkEvent({ memory_id: "mem_neutral", outcome: "neutral_exposure" }), mkEvent({ memory_id: "mem_neutral", outcome: "neutral_exposure" })]);
  const implicitSummary = summarizeReinforcement(Array.from({ length: 5 }, (_, i) => mkEvent({ memory_id: "mem_implicit", outcome: "implicit_success" })));

  const recs = generateMaintenanceRecommendations([mem_correction, mem_reinf, mem_neutral, mem_implicit], [corrSummary, reinfSummary, neutralSummary, implicitSummary]);

  // explicit correction → review + decrease
  if (!recs.some((r: any) => r.memory_id === "mem_corr" && r.kind === "decrease_stability"))
    failures.push("Explicit correction should produce decrease_stability recommendation.");
  if (!recs.some((r: any) => r.memory_id === "mem_corr" && r.requires_review))
    failures.push("Explicit correction recommendations should require review.");

  // neutral exposure → no increase
  if (recs.some((r: any) => r.memory_id === "mem_neutral" && r.kind === "increase_stability"))
    failures.push("Neutral exposure must not produce increase_stability recommendation.");

  // implicit success alone → at most semi-stable (no stable increase)
  const implicitIncrease = recs.find((r: any) => r.memory_id === "mem_implicit" && r.kind === "increase_stability");
  if (implicitIncrease?.suggested_stability === "stable")
    failures.push("Implicit success alone must not suggest stable.");

  // explicit reinforcement >= 2 → can suggest stable
  if (!recs.some((r: any) => r.memory_id === "mem_reinf" && r.kind === "increase_stability" && r.suggested_stability === "stable"))
    failures.push("Explicit reinforcement x2 should produce increase_stability → stable.");

  // patch generated but does not auto-apply
  const patch = buildStabilityPatchFromRecommendations(recs, new Date().toISOString());
  const corrOp = patch.ops.find((op: any) => op.target_id === "mem_corr");
  if (corrOp?.default_selected)
    failures.push("Correction stability decrease must not be default_selected=true.");

  return {
    category: "maintenance_stability",
    description: "Reinforcement-driven maintenance recommendations follow stability rules and do not auto-apply without explicit patch application.",
    pass: failures.length === 0,
    metrics: { recommendations_generated: recs.length, ops_in_patch: patch.ops.length },
    failures,
  };
}


function evalStrictGovernance(): EvalResult {
  const failures: string[] = [];
  const { isAutoApplyEligibleCandidate, buildCandidateTrustMetadata: buildTrust } = require("../src/trust");

  const legacy = { id: "cap_legacy", created_at: new Date().toISOString(), source: { type: "manual", ref: "daily" }, text: "Use bun.", tags: [], evidence_refs: ["daily", "spec"], confidence: 0.9, status: "new" };
  const full = { ...legacy, ...buildTrust("direct_user_instruction", "project"), verification_status: "verified", evidence_ids: ["ev_1"] };
  const lowTrust = { ...legacy, ...buildTrust("repository_text", "project"), verification_status: "review_required", evidence_ids: ["ev_1"] };

  if (!isAutoApplyEligibleCandidate(legacy, "compatibility"))
    failures.push("Legacy candidate must be auto-eligible in compatibility mode.");
  if (isAutoApplyEligibleCandidate(legacy, "strict"))
    failures.push("Legacy candidate must NOT be auto-eligible in strict mode.");
  if (!isAutoApplyEligibleCandidate(full, "strict"))
    failures.push("Fully classified direct_user_instruction candidate must pass strict mode.");
  if (isAutoApplyEligibleCandidate(lowTrust, "compatibility"))
    failures.push("Low-trust candidate must be blocked in compatibility mode.");
  if (isAutoApplyEligibleCandidate(lowTrust, "strict"))
    failures.push("Low-trust candidate must be blocked in strict mode.");

  return {
    category: "strict_governance",
    description: "Strict mode blocks legacy/unclassified candidates; compatibility mode preserves legacy behavior.",
    pass: failures.length === 0,
    metrics: { scenarios_tested: 5 },
    failures,
  };
}

function evalMetaConsolidationSafety(): EvalResult {
  const failures: string[] = [];
  const dir = tempRoot("pi-eval-meta-");
  const { unsafeAddMemoryRecord: addRecord } = require("../src/store");
  const { clusterL2Records, searchCounterexamples, generateMetaConsolidationCandidates } = require("../src/meta-consolidation");

  const baseRecord = (id: string, profileId = "project:test") => ({
    id, profile_id: profileId, layer: "L2", scope: { type: "global" }, tags: ["workflow"],
    statement: `${id} use canonical JSONL.`, evidence: [{ type: "manual", ref: "x", note: "n" }],
    confidence: 0.9, stability: "stable", created_at: "2026-05-19", updated_at: "2026-05-19",
    review: { cadence_days: 30, next_review: "2026-06-18", change_condition: "c" },
    status: "active", supersedes: [], superseded_by: [], vault_ref: null, ruleType: "workflow",
    normalized_key: `${profileId.replace(":", "-")}|global|global|memory|workflow`,
  });

  // Add records from two different profiles — should NOT cluster together
  addRecord(dir, baseRecord("mem_a", "project:alpha"));
  addRecord(dir, baseRecord("mem_b", "project:alpha"));
  addRecord(dir, { ...baseRecord("mem_beta", "project:beta"), normalized_key: "project-beta|global|global|memory|workflow" });

  const all = [baseRecord("mem_a", "project:alpha"), baseRecord("mem_b", "project:alpha"), { ...baseRecord("mem_beta", "project:beta"), normalized_key: "project-beta|global|global|memory|workflow" }];
  const clusters = clusterL2Records(all, "project:alpha");

  if (clusters.some((c: any) => c.source_memory_ids.includes("mem_beta")))
    failures.push("Cross-profile clustering: project:beta record clustered with project:alpha");

  for (const cluster of clusters) {
    const result = searchCounterexamples(dir, cluster, all);
    if (!result.performed)
      failures.push("Counterexample search not performed.");
  }

  // Check no auto-apply: generate candidates and verify they are all l1_review_only
  const config = { enabled: true, cadence: "manual", min_l2_records: 2, min_reinforcement_score: 0, max_candidates_per_run: 5, max_input_records: 50, require_counterexample_search: true };
  const candidates = generateMetaConsolidationCandidates(dir, clusters, all, config, new Date().toISOString());
  for (const candidate of candidates) {
    if (candidate.promotion_eligibility !== "l1_review_only")
      failures.push(`Candidate ${candidate.id} is not l1_review_only.`);
    if (candidate.proposed_layer !== "L1")
      failures.push(`Candidate ${candidate.id} not proposed as L1.`);
  }

  // Verify contested records excluded
  const withContested = [...all, { ...baseRecord("mem_contested", "project:alpha"), status: "contested" }];
  const clustersWithContested = clusterL2Records(withContested, "project:alpha");
  const allClustered = clustersWithContested.flatMap((c: any) => c.source_memory_ids);
  if (allClustered.includes("mem_contested"))
    failures.push("Contested record included in clusters.");

  return {
    category: "meta_consolidation_safety",
    description: "Meta-consolidation must not cross profiles, not auto-apply, and exclude contested/deleted records.",
    pass: failures.length === 0,
    metrics: { clusters_found: clusters.length, candidates_proposed: candidates.length },
    failures,
    hard_invariant: true,
  };
}

function evalDiagnosticsCleanStore(): EvalResult {
  const dir = tempRoot("pi-eval-diag-");
  const { runMemoryDiagnostics } = require("../src/diagnostics");
  const { unsafeAddMemoryRecord: addRecord } = require("../src/store");
  const rec = { id: "mem_diag_clean", layer: "L2", scope: { type: "global" }, tags: ["workflow"], statement: "Clean record.", evidence: [{ type: "manual", ref: "x", note: "n" }], confidence: 0.9, stability: "semi-stable", created_at: "2026-05-20", updated_at: "2026-05-20", review: { cadence_days: 30, next_review: "2026-06-20", change_condition: "c" }, status: "active", supersedes: [], superseded_by: [], vault_ref: null };
  addRecord(dir, rec);
  const report = runMemoryDiagnostics(dir);
  const errors = report.findings.filter((f: any) => f.severity === "error");
  const failures = errors.map((f: any) => `${f.code}: ${f.message}`);
  return {
    category: "diagnostics_clean_store",
    description: "Diagnostics must report zero errors on a clean generated store.",
    pass: errors.length === 0,
    metrics: { findings: report.findings.length, errors: report.summary.errors, warnings: report.summary.warnings },
    failures,
    hard_invariant: true,
  };
}

function evalContestedNotInHardRules(): EvalResult {
  const { extractHardRules } = require("../src/rules");
  const failures: string[] = [];
  const contested = {
    id: "mem_c", layer: "L2", scope: { type: "global" }, tags: ["correction"], statement: "Avoid using X.", evidence: [{ type: "manual", ref: "x", note: "n" }], confidence: 0.95, stability: "stable", created_at: "2026-05-20", updated_at: "2026-05-20", review: { cadence_days: 30, next_review: "2026-06-20", change_condition: "c" }, status: "contested", supersedes: [], superseded_by: [], vault_ref: null, ruleType: "avoid_pattern",
  };
  const hardRules = extractHardRules([contested]);
  if (hardRules.length > 0) failures.push("Contested record appears in extractHardRules output.");
  return {
    category: "contested_not_in_hard_rules",
    description: "Contested records must never appear as hard rules.",
    pass: failures.length === 0,
    metrics: { contested_hard_rules: hardRules.length },
    failures,
    hard_invariant: true,
  };
}

function evalSecretPersistenceBlocked(): EvalResult {
  const dir = tempRoot("pi-eval-secret-");
  const { extractCorrectionCandidate } = require("../src/corrections");
  const { appendEvidenceRecord } = require("../src/evidence");
  const failures: string[] = [];
  const secret = "Always use token " + "gh" + "p_" + "abcdefghijklmnopqrstuvwxyz0123456789ABCD";
  const candidate = extractCorrectionCandidate(secret, "2026-06-01", "/tmp");
  if (candidate) failures.push("Correction candidate persisted secret-like content.");
  try {
    appendEvidenceRecord(dir, { id: "ev_secret", resource_id: "r", profile_id: "p", created_at: "2026-06-01", source_kind: "manual", source_summary: secret, trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: [], redaction_status: "none" });
    failures.push("Evidence append accepted secret-like content.");
  } catch { /* expected */ }
  return { category: "secret_persistence_blocked", description: "High-confidence secrets must not persist in candidates or evidence.", pass: failures.length === 0, metrics: { failures: failures.length }, failures, hard_invariant: true };
}

function evalProvenanceLiveness(): EvalResult {
  const dir = tempRoot("pi-eval-live-");
  const { unsafeAddMemoryRecord } = require("../src/store");
  const { appendEvidenceRecord } = require("../src/evidence");
  const { checkProvenanceLiveness } = require("../src/provenance-liveness");
  appendEvidenceRecord(dir, { id: "ev_live", resource_id: "r", profile_id: "p", created_at: "2026-06-01", source_kind: "file", source_file: join(dir, "missing.md"), source_summary: "missing", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_live"], redaction_status: "none" });
  unsafeAddMemoryRecord(dir, record("mem_live", "Use missing evidence.", { evidence: [{ type: "manual", ref: "ev_live", note: "support" }] }));
  const result = checkProvenanceLiveness(dir);
  const pass = result.findings.some((f: any) => f.code === "source_file_missing") && result.reverification_memory_ids.includes("mem_live");
  return { category: "provenance_liveness", description: "Missing source context triggers review pressure without mutation.", pass, metrics: { findings: result.findings.length }, failures: pass ? [] : ["Missing file did not produce liveness/reverification finding."] };
}

function evalDependencyReverification(): EvalResult {
  const dir = tempRoot("pi-eval-reverify-");
  const { unsafeAddMemoryRecord } = require("../src/store");
  const { appendEvidenceRecord } = require("../src/evidence");
  const { generateReverificationRecommendations } = require("../src/reverification");
  appendEvidenceRecord(dir, { id: "ev_dead", resource_id: "r", profile_id: "p", created_at: "2026-06-01", source_kind: "manual", source_summary: "gone", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["mem_dep"], redaction_status: "deleted" });
  unsafeAddMemoryRecord(dir, record("mem_dep", "Use dependent evidence.", { evidence: [{ type: "manual", ref: "ev_dead", note: "support" }] }));
  const recs = generateReverificationRecommendations(dir);
  const pass = recs.some((r: any) => r.memory_id === "mem_dep" && r.priority === "high");
  return { category: "dependency_reverification", description: "Dependent memories are flagged when supporting evidence is invalidated.", pass, metrics: { recommendations: recs.length }, failures: pass ? [] : ["Invalidated evidence did not produce high-priority re-verification."] };
}

function evalTemporalValidity(): EvalResult {
  const { getMemoryValidity } = require("../src/timeline");
  const old = record("mem_old", "Old", { status: "superseded", superseded_by: ["mem_new"] });
  const replacement = record("mem_new", "New", { created_at: "2026-07-01", supersedes: ["mem_old"] });
  const validity = getMemoryValidity(old, [], [replacement]);
  const pass = validity.valid_from === old.created_at && validity.valid_to === "2026-07-01" && validity.invalidated_by === "mem_new";
  return { category: "temporal_validity", description: "Superseded records produce effective validity without mutating legacy records.", pass, metrics: { has_valid_to: validity.valid_to ? 1 : 0 }, failures: pass ? [] : ["Effective validity was not inferred correctly."], hard_invariant: true };
}

function evalIntentTraceIntegrity(): EvalResult {
  const dir = tempRoot("pi-eval-intent-");
  const { unsafeAddMemoryRecord, loadAllRecords } = require("../src/store");
  const { generateGoalHandoffSnapshot } = require("../src/meta-consolidation");
  unsafeAddMemoryRecord(dir, record("mem_goal", "Use goal context."));
  const before = loadAllRecords(dir).length;
  const snapshot = generateGoalHandoffSnapshot(dir, { declared_goal: "Do not publish", now: "2026-06-01T00:00:00Z" });
  const after = loadAllRecords(dir).length;
  const pass = before === after && snapshot.active_memory_ids.includes("mem_goal") && snapshot.background_reference_warning.includes("background reference");
  return { category: "intent_trace_integrity", description: "Goal handoff includes context without mutating memory.", pass, metrics: { active_memory_ids: snapshot.active_memory_ids.length }, failures: pass ? [] : ["Goal handoff mutated memory or missed context."] };
}

function evalConflictAtPatchApply(): EvalResult {
  const dir = tempRoot("pi-eval-conflict-");
  const { unsafeAddMemoryRecord, loadAllRecords } = require("../src/store");
  const { applyPatch } = require("../src/patch");
  unsafeAddMemoryRecord(dir, record("mem_conflict", "Existing."));
  const patch = { patch_id: "patch_conflict", created_at: "2026-06-01", generated_by: "manual", mode: "auto", summary: "conflict", ops: [{ op_id: "op_add", op: "add", record: record("mem_conflict", "Duplicate."), risk: "low", default_selected: true }], status: "proposed", applied_at: null, applied_ops: [], skipped_ops: [] };
  const applied = applyPatch(dir, patch, { now: "2026-06-01T00:00:00Z" });
  const dupes = loadAllRecords(dir).filter((r: any) => r.id === "mem_conflict").length;
  const pass = applied.applied_ops.length === 0 && applied.skipped_ops.includes("op_add") && dupes === 1;
  return { category: "conflict_at_patch_apply", description: "Stale/conflicting patch ops are blocked at apply time.", pass, metrics: { duplicate_records: dupes, skipped_ops: applied.skipped_ops.length }, failures: pass ? [] : ["Conflicting add was not blocked at apply time."], hard_invariant: true };
}

async function evalPolicyOnlyNoRawMemory(): Promise<EvalResult> {
  const dir = tempRoot("pi-eval-policy-");
  writeFileSync(join(dir, "config.json"), JSON.stringify({ retrieval: { injectionMode: "policy_only" } }));
  unsafeAddMemoryRecord(dir, record("mem_policy", "Raw private workflow text must not inject.", { ruleType: "workflow" }));
  const ctx = await buildRetrievalContext(dir, { prompt: "workflow", today: "2026-06-01", cwd: dir });
  const pass = ctx.markdown.includes("PI memory exists") && !ctx.markdown.includes("Raw private workflow text") && ctx.selectedMemory.length === 0;
  return { category: "policy_only_no_raw_memory", description: "Policy-only mode must not inject raw selected memory records.", pass, metrics: { chars: ctx.markdown.length, selected: ctx.selectedMemory.length }, failures: pass ? [] : ["Policy-only mode leaked raw memory or selected records."], hard_invariant: true };
}

function evalProcedureCandidateReviewOnly(): EvalResult {
  const dir = tempRoot("pi-eval-procedure-");
  const { generateProcedureCandidates } = require("../src/procedure-candidates");
  const before = loadAllRecords(dir).length;
  unsafeAddMemoryRecord(dir, record("mem_proc_a", "Run bun test before commit.", { tags: ["workflow", "testing"], stability: "stable", ruleType: "workflow" }));
  unsafeAddMemoryRecord(dir, record("mem_proc_b", "Run bun run typecheck before push.", { tags: ["workflow", "testing"], stability: "stable", ruleType: "workflow" }));
  const afterWrites = loadAllRecords(dir).length;
  const report = generateProcedureCandidates(dir, { minSourceRecords: 2 });
  const afterReport = loadAllRecords(dir).length;
  const candidate = report.candidates[0];
  const pass = afterWrites === before + 2 && afterReport === afterWrites && candidate?.requires_review === true && candidate.source_memory_ids.length === 2;
  return { category: "procedure_candidate_review_only", description: "Procedure candidates are report-only and require review.", pass, metrics: { candidates: report.candidates.length, source_ids: candidate?.source_memory_ids.length ?? 0 }, failures: pass ? [] : ["Procedure candidate mutated memory or did not require review."] };
}

function evalRecallXrayScopeExplanation(): EvalResult {
  const root = tempRoot();
  unsafeAddMemoryRecord(root, record("mem_keep", "Use bun test for this repo.", { profile_id: "project:alpha" }));
  unsafeAddMemoryRecord(root, record("mem_other", "Use npm for other repo.", { profile_id: "project:beta" }));
  const report = buildRecallXray(root, { query: "bun test", profile_id: "project:alpha", resource_id: "repo" });
  const pass = report.included.some((m) => m.memory_id === "mem_keep") && report.excluded.some((m) => m.memory_id === "mem_other" && m.scope_mismatch);
  return { category: "recall_xray_scope_explanation", description: "Recall X-ray explains included memories and profile-scope exclusions.", pass, metrics: { included: report.summary.included_count, excluded: report.summary.excluded_count }, failures: pass ? [] : ["Recall X-ray did not explain included/scope-excluded memories."] };
}

function evalMemoryWorthRejectsTrivial(): EvalResult {
  const result = scoreMemoryWorth({ observation: "ok thanks" });
  const pass = result.decision === "reject";
  return { category: "memory_worth_rejects_trivial", description: "Memory-worth scoring rejects low-information observations.", pass, metrics: { worth_score: result.worth_score, decision: result.decision }, failures: pass ? [] : [`Expected reject, got ${result.decision}`] };
}

function evalMemoryWorthInquiryForAmbiguous(): EvalResult {
  const result = scoreMemoryWorth({ observation: "The release process is critical but unclear.", operationalImpact: 0.95 });
  const pass = result.decision === "inquiry";
  return { category: "memory_worth_inquiry_for_ambiguous", description: "Important but underspecified observations become inquiries.", pass, metrics: { worth_score: result.worth_score, decision: result.decision }, failures: pass ? [] : [`Expected inquiry, got ${result.decision}`] };
}

function evalBackgroundJobNoDirectMutation(): EvalResult {
  const root = tempRoot();
  const before = loadAllRecords(root).length;
  enqueueBackgroundAnalysis(root, { kind: "diagnostics" }, "2026-06-01T00:00:00Z");
  const jobs = runBackgroundAnalysisQueue(root, { now: "2026-06-01T00:01:00Z" });
  const after = loadAllRecords(root).length;
  const pass = jobs[0]?.status === "succeeded" && before === after;
  return { category: "background_job_no_direct_mutation", description: "Background diagnostics produce artifacts without durable memory mutation.", pass, metrics: { jobs: jobs.length, before_records: before, after_records: after }, failures: pass ? [] : ["Background job mutated memory or failed."] , hard_invariant: true};
}

function evalCodebaseEvidenceNoBypass(): EvalResult {
  const root = tempRoot();
  appendEvidenceRecord(root, { id: "ev_code", resource_id: "repo", profile_id: "project", created_at: "2026-06-01T00:00:00Z", source_kind: "codebase_analysis", source_summary: "typecheck passed", trust_class: "passing_tool_or_test_outcome", polarity: "supports", related_memory_ids: [], codebase_analysis: { source_kind: "codebase_analysis", tool: "tsc", command: "bun run typecheck", exit_code: 0, analysis_kind: "typecheck", confidence: 0.8, timestamp: "2026-06-01T00:00:00Z" } });
  appendCandidate(root, candidate("Typecheck currently passes.", { source: { type: "codebase_analysis", ref: "ev_code" }, evidence_ids: ["ev_code"], evidence_refs: ["ev_code"], primary_trust_class: "passing_tool_or_test_outcome", promotion_eligibility: "review_only", poisoning_risk: "low" }));
  const patch = curateInbox(root, { now: "2026-06-01T00:01:00Z", mode: "auto" });
  const pass = !patch.ops.some((op) => op.default_selected);
  return { category: "codebase_evidence_no_bypass", description: "Deterministic codebase evidence supports candidates but does not bypass review.", pass, metrics: { ops: patch.ops.length, default_selected: patch.ops.filter((op) => op.default_selected).length }, failures: pass ? [] : ["Codebase evidence produced an auto-selected patch op."], hard_invariant: true };
}

function evalDocsContractCommandConfigSync(): EvalResult {
  const readme = readFileSync("README.md", "utf-8");
  const index = readFileSync("index.ts", "utf-8");
  const registered = new Set([...index.matchAll(/registerCommand\("([^"]+)"/g)].map((m) => m[1]));
  const documented = [...readme.matchAll(/`\/(memory-[a-z0-9-]+|curate-memory|maintain-memory|meta-consolidation|render-memory|consolidate-memory|setup-session-search|session-sync|session-reindex|procedure-candidates)(?:\s[^`]*)?`/g)].map((m) => m[1]);
  const missing = [...new Set(documented)].filter((cmd) => !registered.has(cmd));
  const pass = missing.length === 0 && readme.includes("autoCurate") && !readme.includes("auto_curate");
  return { category: "docs_contract_command_config_sync", description: "README documented commands/config keys stay in sync with registry and schema naming.", pass, metrics: { documented_commands: documented.length, missing: missing.length }, failures: missing.map((cmd) => `Missing registered command: ${cmd}`) };
}

function evalReplayProjectConventionRecall(): EvalResult {
  const root = tempRoot();
  unsafeAddMemoryRecord(root, record("mem_bun", "This project uses Bun for tests; run bun test.", { tags: ["testing", "workflow"], ruleType: "convention", memory_kind: "instruction", confidence: 0.92 }));
  unsafeAddMemoryRecord(root, record("mem_npm_old", "Use npm test for tests.", { status: "superseded", tags: ["testing"], confidence: 0.8 }));
  const worth = scoreMemoryWorth({ observation: "Do not suggest npm test here; use bun test.", explicitUserRequest: true, evidenceStrength: 0.9, durability: "project", scope: "project" });
  const xray = buildRecallXray(root, { query: "how do I run tests? bun", profile_id: "default", resource_id: "default" });
  const pass = worth.decision === "candidate" && xray.included.some((m) => m.memory_id === "mem_bun") && xray.excluded.some((m) => m.memory_id === "mem_npm_old" && m.superseded);
  return { category: "replay_project_convention_recall", description: "Multi-turn convention/correction replay recalls Bun and excludes superseded npm truth.", pass, metrics: { included: xray.summary.included_count, excluded: xray.summary.excluded_count, worth: worth.decision }, failures: pass ? [] : ["Bun convention replay did not recall/exclude as expected."] };
}

function evalReplayNegativeScopeExclusion(): EvalResult {
  const root = tempRoot();
  unsafeAddMemoryRecord(root, record("mem_lms_frontend", "Use pnpm test for LMS frontend only.", { scope: { type: "project", project: "lms-frontend" }, does_not_apply_when: ["pi package"], tags: ["testing"] }));
  unsafeAddMemoryRecord(root, record("mem_pi", "Use bun test for PI package.", { scope: { type: "project", project: "pi-persistent-intelligence" }, tags: ["testing"] }));
  const xray = buildRecallXray(root, { query: "pi package test command", profile_id: "default", resource_id: "default", project_root: "/tmp/pi-persistent-intelligence", working_directory: "/tmp/pi-persistent-intelligence" });
  const excluded = xray.excluded.find((m) => m.memory_id === "mem_lms_frontend");
  const pass = Boolean(excluded?.scope_mismatch || excluded?.negative_scope_match);
  return { category: "replay_negative_scope_exclusion", description: "Replay excludes LMS-only memory in PI package context.", pass, metrics: { excluded: xray.summary.excluded_count }, failures: pass ? [] : ["LMS frontend memory was not explained as excluded."] };
}

function evalReplayCodebaseEvidenceSupport(): EvalResult {
  const root = tempRoot();
  appendEvidenceRecord(root, { id: "ev_tsc", resource_id: "repo", profile_id: "project", created_at: "2026-06-01T00:00:00Z", source_kind: "codebase_analysis", source_summary: "tsc --noEmit passed", trust_class: "passing_tool_or_test_outcome", polarity: "supports", related_memory_ids: ["mem_typecheck"], codebase_analysis: { source_kind: "codebase_analysis", tool: "tsc", command: "tsc --noEmit", exit_code: 0, analysis_kind: "typecheck", timestamp: "2026-06-01T00:00:00Z" } });
  unsafeAddMemoryRecord(root, record("mem_typecheck", "Run tsc --noEmit for typecheck evidence.", { evidence: [{ type: "codebase_analysis", ref: "ev_tsc", note: "typecheck passed" }], tags: ["testing"] }));
  const xray = buildRecallXray(root, { query: "typecheck evidence", profile_id: "project", resource_id: "repo" });
  const included = xray.included.find((m) => m.memory_id === "mem_typecheck");
  const patch = curateInbox(root, { now: "2026-06-01T00:00:00Z", mode: "auto" });
  const pass = included?.evidence_source_kinds?.includes("codebase_analysis") === true && !patch.ops.some((op) => op.default_selected);
  return { category: "replay_codebase_evidence_support", description: "Replay shows codebase evidence as support without auto-truth bypass.", pass, metrics: { included: xray.summary.included_count, default_selected_ops: patch.ops.filter((op) => op.default_selected).length }, failures: pass ? [] : ["Codebase evidence replay failed support/no-bypass expectation."] };
}

function evalReplayMemoryWorthRejection(): EvalResult {
  const root = tempRoot();
  const worth = scoreMemoryWorth({ observation: "ok thanks" });
  if (worth.decision === "candidate") appendCandidate(root, candidate("ok thanks"));
  const pass = worth.decision !== "candidate" && listCandidates(root).length === 0;
  return { category: "replay_memory_worth_rejection", description: "Replay rejects trivial observation without durable candidate.", pass, metrics: { worth: worth.decision, candidates: listCandidates(root).length }, failures: pass ? [] : ["Trivial observation became durable candidate."] };
}

function evalReplayBackgroundJobNoMutation(): EvalResult {
  const root = tempRoot();
  unsafeAddMemoryRecord(root, record("mem_bg_replay", "Use bun test."));
  const before = loadAllRecords(root).length;
  enqueueBackgroundAnalysis(root, { kind: "diagnostics" }, "2026-06-01T00:00:00Z");
  enqueueBackgroundAnalysis(root, { kind: "reverification" }, "2026-06-01T00:00:01Z");
  const jobs = runBackgroundAnalysisQueue(root, { now: "2026-06-01T00:01:00Z" });
  const pass = jobs.every((job) => job.status === "succeeded") && loadAllRecords(root).length === before && jobs.every((job) => Boolean(job.output_artifact_path));
  return { category: "replay_background_job_no_mutation", description: "Replay runs background reports without canonical durable memory mutation.", pass, metrics: { jobs: jobs.length, records_before: before, records_after: loadAllRecords(root).length }, failures: pass ? [] : ["Background replay mutated memory or failed to produce artifacts."], hard_invariant: true };
}

function evalEvidenceLinkCreatesReviewCandidateNoBypass(): EvalResult {
  const root = tempRoot();
  const evidence = appendEvidenceRecord(root, { id: "", resource_id: "r", profile_id: "p", created_at: "n", source_kind: "codebase_analysis", source_summary: "bun test passed", trust_class: "passing_tool_or_test_outcome", polarity: "supports", durability_signal: "project", related_memory_ids: [], codebase_analysis: { source_kind: "codebase_analysis", tool: "vitest", analysis_kind: "test", exit_code: 0, timestamp: "n" } });
  const result = linkEvidenceToCandidate(root, { evidence_id: evidence.id, statement: "Always run bun test before commit.", tags: ["testing"], confidence: 1 });
  const pass = result.status === "candidate_created" && listCandidates(root).length === 1 && loadAllRecords(root).length === 0 && (result.candidate?.promotion_eligibility === "review_only");
  return { category: "evidence_link_creates_review_candidate_no_bypass", description: "Evidence linking creates review candidate without durable mutation or confidence bypass.", pass, metrics: { candidates: listCandidates(root).length, durable_records: loadAllRecords(root).length }, failures: pass ? [] : ["Evidence link bypassed review or failed."], hard_invariant: true };
}

function evalRecallXrayContextBudgetExplainsOmissions(): EvalResult {
  const root = tempRoot();
  unsafeAddMemoryRecord(root, record("mem_bun", "Always run bun test before commit."));
  unsafeAddMemoryRecord(root, record("mem_other", "Use cargo test in Rust projects."));
  const report = buildRecallXray(root, { query: "bun test" });
  const budget = report.summary.context_budget;
  const pass = budget.selected_count === report.included.length && budget.omitted_count === report.excluded.length && typeof budget.estimated_tokens === "number";
  return { category: "recall_xray_context_budget_explains_omissions", description: "Recall X-ray reports budget and omission counts.", pass, metrics: { selected: budget.selected_count, omitted: budget.omitted_count, tokens: budget.estimated_tokens ?? 0 }, failures: pass ? [] : ["Context budget missing or inconsistent."] };
}

function evalReversibleCompactionPreservesSourceTrace(): EvalResult {
  const artifact = createCompactionArtifact({ compacted_text: "Always run bun test.", original_source_text: "User: Always run bun test.", source_session_ids: ["s1"], source_evidence_ids: ["e1"], compression_method: "structured" });
  const pass = artifact.reversible && artifact.source_session_ids.includes("s1") && artifact.original_digest.length > 0;
  return { category: "reversible_compaction_preserves_source_trace", description: "Compaction artifacts preserve digest/source metadata.", pass, metrics: { reversible: String(artifact.reversible), evidence_refs: artifact.source_evidence_ids.length }, failures: pass ? [] : ["Compaction trace missing."] };
}

function evalCapturedReplayCorrectionPrecision(): EvalResult {
  const root = tempRoot();
  const result = runReplayFixture(root, { fixture_id: "eval_replay_correction", description: "synthetic", redaction_version: "synthetic-v1", synthetic: true, sessions: [{ session_id: "s", turns: [{ role: "user", content: "This project uses bun, not npm. Always run bun test before commit.", expected_capture: true }] }], expected: { candidates: ["Always run bun test before commit"], recall_query: "bun test", expected_recalled_memory_ids: ["mem_always_run_bun_test_before_commit"] } });
  const pass = result.failures.length === 0 && result.candidates_created > 0;
  return { category: "captured_replay_correction_precision", description: "Synthetic captured-style correction fixture replays successfully.", pass, metrics: { candidates: result.candidates_created, noise: result.noise_count }, failures: result.failures };
}

function evalCapturedReplayTemporaryInstructionNotDurable(): EvalResult {
  const root = tempRoot();
  const result = runReplayFixture(root, { fixture_id: "eval_replay_temporary", description: "synthetic", redaction_version: "synthetic-v1", synthetic: true, sessions: [{ session_id: "s", turns: [{ role: "user", content: "For this one run, skip lint.", expected_no_capture: true }] }], expected: { rejected: ["skip lint"] } });
  const pass = result.rejected_observations > 0 && result.candidates_created === 0;
  return { category: "captured_replay_temporary_instruction_not_durable", description: "Temporary one-off instruction is not durable.", pass, metrics: { rejected: result.rejected_observations, candidates: result.candidates_created }, failures: pass ? [] : ["Temporary instruction became durable."] };
}

function evalCapturedReplayRedactionSafety(): EvalResult {
  const redacted = redactReplayContent("/home/alice/project OPENAI_API_KEY=abcdef1234567890 user@example.com", { redactUrls: true });
  const pass = !redacted.includes("/home/alice") && !redacted.includes("abcdef") && !redacted.includes("user@example.com");
  return { category: "captured_replay_redaction_safety", description: "Replay redactor removes high-risk content.", pass, metrics: {}, failures: pass ? [] : ["Redaction failed."] };
}

function evalRecallXrayScoreProvenanceReportsAvailableScores(): EvalResult {
  const root = tempRoot();
  unsafeAddMemoryRecord(root, record("mem_bun", "Always run bun test before commit."));
  const item = buildRecallXray(root, { query: "bun test" }).included.find((entry) => entry.memory_id === "mem_bun");
  const pass = Boolean(item?.score_provenance?.fts_score && item.score_provenance.semantic_provider === "none" && item.score_provenance.semantic_score === undefined);
  return { category: "recall_xray_score_provenance_reports_available_scores", description: "Recall X-ray reports available scores and does not fabricate semantic scores.", pass, metrics: { fts_score: item?.score_provenance?.fts_score ?? 0 }, failures: pass ? [] : ["Score provenance missing or fabricated."] };
}

function evalComputedConfidenceRespectsTrustBoundaries(): EvalResult {
  const low = computeCandidateConfidence({ primaryTrustClass: "repository_text", userProvidedConfidence: 1, evidenceRecords: [{ id: "e", resource_id: "r", profile_id: "p", created_at: "n", source_kind: "file", source_summary: "x", trust_class: "repository_text", polarity: "supports", related_memory_ids: [] }] });
  const pass = low.confidence < 0.85 && low.review_required;
  return { category: "computed_confidence_respects_trust_boundaries", description: "Computed confidence clamps low-trust user/LLM-provided confidence.", pass, metrics: { confidence: low.confidence }, failures: pass ? [] : ["Low trust confidence bypassed boundaries."], hard_invariant: true };
}

function evalSkillDraftExportReviewGatedNoAutowrite(): EvalResult {
  const root = tempRoot();
  const ev = appendEvidenceRecord(root, { id: "ev", resource_id: "r", profile_id: "default", created_at: "n", source_kind: "conversation", source_summary: "run tests", trust_class: "direct_user_instruction", polarity: "supports", related_memory_ids: ["m1"] });
  unsafeAddMemoryRecord(root, record("m1", "Always run bun test before commit.", { stability: "stable", profile_id: "default", evidence: [{ type: "manual", ref: ev.id, note: "n" }] }));
  unsafeAddMemoryRecord(root, record("m2", "Run typecheck before commit.", { stability: "stable", profile_id: "default", evidence: [{ type: "manual", ref: ev.id, note: "n" }] }));
  const result = draftSkillFromProcedureCandidate(root, "", "2026-06-15T00:00:00Z");
  const pass = result.status === "draft_created" && result.artifact?.export_status === "review_required";
  return { category: "skill_draft_export_review_gated_no_autowrite", description: "Skill draft is review artifact only.", pass, metrics: {}, failures: pass ? [] : ["Skill draft boundary failed."], hard_invariant: true };
}

function evalFailureAnalysisReviewOnlyCandidates(): EvalResult {
  const root = tempRoot();
  appendCandidate(root, { id: "cap_rejected_eval", created_at: "n", source: { type: "manual", ref: "x" }, text: "Always prefer bun after failed npm test.", tags: ["testing"], evidence_refs: ["x"], confidence: 0.6, status: "rejected" });
  const before = loadAllRecords(root).length;
  const { report } = runFailureAnalysis(root);
  const pass = report.items.length > 0 && loadAllRecords(root).length === before;
  return { category: "failure_analysis_review_only_candidates", description: "Failure analysis creates review artifacts without durable mutation.", pass, metrics: { items: report.items.length }, failures: pass ? [] : ["Failure analysis mutated durable memory or produced no items."], hard_invariant: true };
}

function evalBackgroundMetaConsolidationReportOnly(): EvalResult {
  const root = tempRoot();
  unsafeAddMemoryRecord(root, record("m1", "Always run bun test before commit.", { stability: "stable", profile_id: "default", normalized_key: "default|workflow" }));
  unsafeAddMemoryRecord(root, record("m2", "Run typecheck before commit.", { stability: "stable", profile_id: "default", normalized_key: "default|workflow" }));
  enqueueBackgroundAnalysis(root, { kind: "meta_consolidation", profile_id: "default" });
  const beforeL1 = loadActiveRecords(root).filter((r) => r.layer === "L1").length;
  const jobs = runBackgroundAnalysisQueue(root);
  const afterL1 = loadActiveRecords(root).filter((r) => r.layer === "L1").length;
  const pass = jobs[0].status === "succeeded" && beforeL1 === afterL1;
  return { category: "background_meta_consolidation_report_only", description: "Background meta-consolidation is report-only.", pass, metrics: { before_l1: beforeL1, after_l1: afterL1 }, failures: pass ? [] : ["Meta background mutated L1 or failed."], hard_invariant: true };
}

function evalBackgroundVaultPromotionReviewOnly(): EvalResult {
  const root = tempRoot();
  appendCandidate(root, candidate("Promote this to vault after review."));
  enqueueBackgroundAnalysis(root, { kind: "vault_promotion_candidates" });
  const jobs = runBackgroundAnalysisQueue(root);
  const pass = jobs[0].status === "succeeded" && jobs[0].warnings?.join(" ").includes("no vault files were mutated");
  return { category: "background_vault_promotion_review_only", description: "Background vault promotion creates review artifact only.", pass, metrics: { jobs: jobs.length }, failures: pass ? [] : ["Vault promotion boundary failed."], hard_invariant: true };
}

async function runEvals(): Promise<void> {
  const start = Date.now();
  const results: EvalResult[] = [];

  process.stdout.write("Running PI Persistent Intelligence Eval Suite\n");
  process.stdout.write("=".repeat(50) + "\n\n");

  const evals: [string, () => EvalResult | Promise<EvalResult>][] = [
    ["Correction Capture Precision/Recall", evalCorrectionCapture],
    ["Trust Boundary Adherence", evalTrustBoundary],
    ["Injection Relevance + Profile Leakage", evalInjectionAndProfileLeakage],
    ["Conflict / Exception Behavior", evalConflictBehavior],
    ["Deletion / Forgetting Behavior", evalDeletionBehavior],
    ["Inquiry Surfacing / Noise", evalInquirySurfacing],
    ["Reinforcement Summary Behavior", evalReinforcementSummary],
    ["Context-Compaction Lifecycle", evalContextCompactionLifecycle],
    ["Legacy Compatibility", evalLegacyCompatibility],
    ["Maintenance / Stability Recommendations", evalMaintenanceStability],
    ["Strict Governance Mode", evalStrictGovernance],
    ["Meta-Consolidation Safety", evalMetaConsolidationSafety],
    ["Diagnostics Clean Store", evalDiagnosticsCleanStore],
    ["Contested Records Not In Hard Rules", evalContestedNotInHardRules],
    ["Secret Persistence Blocked", evalSecretPersistenceBlocked],
    ["Provenance Liveness", evalProvenanceLiveness],
    ["Dependency Reverification", evalDependencyReverification],
    ["Temporal Validity", evalTemporalValidity],
    ["Intent Trace Integrity", evalIntentTraceIntegrity],
    ["Conflict At Patch Apply", evalConflictAtPatchApply],
    ["Policy Only No Raw Memory", evalPolicyOnlyNoRawMemory],
    ["Procedure Candidate Review Only", evalProcedureCandidateReviewOnly],
    ["Recall X-ray Scope Explanation", evalRecallXrayScopeExplanation],
    ["Memory-worth Rejects Trivial", evalMemoryWorthRejectsTrivial],
    ["Memory-worth Inquiry For Ambiguous", evalMemoryWorthInquiryForAmbiguous],
    ["Background Job No Direct Mutation", evalBackgroundJobNoDirectMutation],
    ["Codebase Evidence No Bypass", evalCodebaseEvidenceNoBypass],
    ["Docs Contract Command Config Sync", evalDocsContractCommandConfigSync],
    ["Replay Project Convention Recall", evalReplayProjectConventionRecall],
    ["Replay Negative Scope Exclusion", evalReplayNegativeScopeExclusion],
    ["Replay Codebase Evidence Support", evalReplayCodebaseEvidenceSupport],
    ["Replay Memory-worth Rejection", evalReplayMemoryWorthRejection],
    ["Replay Background Job No Mutation", evalReplayBackgroundJobNoMutation],
    ["Evidence Link Creates Review Candidate No Bypass", evalEvidenceLinkCreatesReviewCandidateNoBypass],
    ["Recall X-ray Context Budget Explains Omissions", evalRecallXrayContextBudgetExplainsOmissions],
    ["Reversible Compaction Preserves Source Trace", evalReversibleCompactionPreservesSourceTrace],
    ["Captured Replay Correction Precision", evalCapturedReplayCorrectionPrecision],
    ["Captured Replay Temporary Instruction Not Durable", evalCapturedReplayTemporaryInstructionNotDurable],
    ["Captured Replay Redaction Safety", evalCapturedReplayRedactionSafety],
    ["Recall X-ray Score Provenance Reports Available Scores", evalRecallXrayScoreProvenanceReportsAvailableScores],
    ["Computed Confidence Respects Trust Boundaries", evalComputedConfidenceRespectsTrustBoundaries],
    ["Skill Draft Export Review Gated No Autowrite", evalSkillDraftExportReviewGatedNoAutowrite],
    ["Failure Analysis Review Only Candidates", evalFailureAnalysisReviewOnlyCandidates],
    ["Background Meta-Consolidation Report Only", evalBackgroundMetaConsolidationReportOnly],
    ["Background Vault Promotion Review Only", evalBackgroundVaultPromotionReviewOnly],
  ];

  for (const [label, fn] of evals) {
    process.stdout.write(`  Running: ${label}... `);
    try {
      const result = await fn();
      results.push(result);
      process.stdout.write(`${result.pass ? "✓ PASS" : "✗ FAIL"}${result.hard_invariant ? " [HARD]" : ""}\n`);
    } catch (err) {
      results.push({ category: label, description: label, pass: false, metrics: {}, failures: [String(err)], hard_invariant: false });
      process.stdout.write(`✗ ERROR — ${err}\n`);
    }
  }

  cleanup();

  const elapsed = Date.now() - start;
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const hardFailed = results.filter((r) => r.hard_invariant && !r.pass).length;

  process.stdout.write("\n" + "=".repeat(50) + "\n");
  process.stdout.write(`Results: ${passed}/${results.length} passed`);
  if (hardFailed > 0) process.stdout.write(` | ${hardFailed} HARD INVARIANT FAILURES`);
  process.stdout.write(` | ${elapsed}ms\n\n`);

  // ── Detailed report ────────────────────────────────────────────────────────
  const reportDir = join("reports", "eval");
  mkdirSync(reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  // Markdown report
  const md = [`# PI Persistent Intelligence Eval Report`, ``, `Generated: ${new Date().toISOString()}`, ``, `## Summary`, ``, `| Result | Count |`, `|--------|-------|`, `| Pass | ${passed} |`, `| Fail | ${failed} |`, `| Total | ${results.length} |`, `| Hard invariant failures | ${hardFailed} |`, ``];
  md.push(`## Category Results`, ``);
  for (const r of results) {
    md.push(`### ${r.hard_invariant ? "⚡ " : ""}${r.category.replace(/_/g, " ")}`);
    md.push(``, `**${r.pass ? "✓ PASS" : "✗ FAIL"}**${r.hard_invariant ? " — hard invariant" : ""}`, ``);
    md.push(`${r.description}`, ``);
    if (Object.keys(r.metrics).length > 0) {
      md.push("**Metrics:**", "");
      for (const [k, v] of Object.entries(r.metrics)) md.push(`- ${k}: \`${v}\``);
      md.push("");
    }
    if (r.failures.length > 0) {
      md.push("**Failures:**", "");
      for (const f of r.failures) md.push(`- ${f}`);
      md.push("");
    }
  }
  if (hardFailed > 0) {
    md.push("## Hard Invariant Violations", "");
    for (const r of results.filter((r) => r.hard_invariant && !r.pass)) {
      md.push(`- **${r.category}**: ${r.failures[0] ?? "see above"}`);
    }
    md.push("");
  }

  const mdPath = join(reportDir, `${timestamp}-eval-report.md`);
  const jsonPath = join(reportDir, `${timestamp}-eval-report.json`);
  writeFileSync(mdPath, md.join("\n"), "utf-8");
  writeFileSync(jsonPath, JSON.stringify({ generated_at: new Date().toISOString(), summary: { passed, failed, total: results.length, hard_invariant_failures: hardFailed, elapsed_ms: elapsed }, results }, null, 2), "utf-8");

  process.stdout.write(`Report written to:\n  ${mdPath}\n  ${jsonPath}\n\n`);

  if (hardFailed > 0) {
    process.stdout.write(`FATAL: ${hardFailed} hard invariant(s) failed.\n`);
    process.exit(1);
  }
  if (failed > 0) {
    process.stdout.write(`WARNING: ${failed} eval(s) failed but no hard invariants violated.\n`);
    process.exit(1);
  }
  process.stdout.write("All evals passed.\n");
}

await runEvals();
