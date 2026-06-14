# PI Sprint 0.10 Follow-up — Recall Attribution and Operational Hardening

Date: 2026-06-13
Branch/commit: `sprint-010-recall-transparency` at base commit `69d6c45bf8208fd457d18aefc5e63362547e9052` with uncommitted sprint changes
Runtime: Bun 1.3.13, Node v24.15.0, npm 11.12.1
Package version before: 0.9.0
Package version after, if changed: 0.9.0 (unchanged)

## Executive summary

This follow-up closes the remaining Sprint 0.10 gaps. Recall X-ray now attributes clean hard-rule recall separately from ordinary scoped/term recall and records governance safety. Background jobs now run diagnostics plus provenance liveness, re-verification, memory graph, memory timeline, procedure candidates, and memory-worth review reports. A safe `/memory-evidence add-codebase-analysis` command creates deterministic codebase evidence with validation and redaction. Memory-worth scoring now gates session consolidation and context-compaction candidates, reducing trivial durable candidates and routing ambiguous high-impact observations to inquiries. The eval suite now includes replay-style scenarios for convention recall, negative-scope exclusion, codebase-evidence support, memory-worth rejection, and background-job no-mutation.

## Current verdict

release candidate

## Files changed

- `CHANGELOG.md`
- `README.md`
- `docs/PI-SPRINT-010-FOLLOW-UP-RECALL-ATTRIBUTION-OPS.md`
- `docs/PI-SPRINT-010-RECALL-TRANSPARENCY-BACKGROUND-OPS.md`
- `docs/dogfood-checklist.md`
- `docs/retain-recall-reflect.md`
- `docs/wiki/commands-and-tools.md`
- `docs/wiki/index.md`
- `docs/wiki/memory-model.md`
- `eval/run-evals.ts`
- `index.ts`
- `src/background-analysis.ts`
- `src/consolidator.ts`
- `src/context-compaction.ts`
- `src/curator.ts`
- `src/diagnostics.ts`
- `src/inbox.ts`
- `src/memory-kind.ts`
- `src/memory-worth.ts`
- `src/procedure-candidates.ts`
- `src/recall-xray.ts`
- `src/types.ts`
- `test/docs/docs-contract.test.ts`
- `test/unit/background-analysis.test.ts`
- `test/unit/codebase-evidence.test.ts`
- `test/unit/consolidator.test.ts`
- `test/unit/context-compaction.test.ts`
- `test/unit/memory-evidence-command.test.ts`
- `test/unit/memory-kind.test.ts`
- `test/unit/memory-worth.test.ts`
- `test/unit/procedure-export-boundary.test.ts`
- `test/unit/recall-xray.test.ts`

## Track 1 — Hard-rule Recall X-ray attribution

### What changed

`/memory-recall-xray <query>` now uses explicit retrieval tiers:

```ts
"hard_rule" | "policy_rule" | "scoped_memory" | "term_match" | "evidence_dependency" | "session_context" | "fallback"
```

Included hard rules now carry:

- `hard_rule: true`
- `rule_type`
- `hard_rule_reason`
- `governance_safe`
- `warnings`

Hard-rule attribution uses the existing `extractHardRules()` logic after policy processors run. Contested/deleted/superseded/tombstoned/negative-scope records are not reported as clean hard truth. In strict governance mode, a typed high-confidence candidate without live structured evidence is included only as ordinary recall and receives a warning rather than `hard_rule` attribution.

### Tests

- `test/unit/recall-xray.test.ts`
  - hard-rule memory appears with `retrieval_tier: "hard_rule"`
  - ordinary memory is not attributed as hard rule
  - contested/tombstoned/negative-scope hard-rule candidates are excluded or warning-only
  - strict unsafe hard-rule attribution is blocked

### Remaining gaps

No blocking gaps. Future refinement can add closer parity with hybrid/semantic ranking explanations if retrieval adds more tiers.

## Track 2 — Background runner expansion

### What changed

`src/background-analysis.ts` now supports report-producing runners beyond diagnostics. Jobs remain local, inspectable, status-tracked, safe to rerun, and non-mutating for durable memory.

### Supported job kinds

- `diagnostics`
- `provenance_liveness`
- `reverification`
- `memory_graph`
- `memory_timeline`
- `procedure_candidates`
- `memory_worth_review`

Unsupported job kinds fail safely with a structured error recorded on the job.

### Tests

- `test/unit/background-analysis.test.ts`
  - provenance liveness job
  - re-verification job
  - graph/timeline/procedure/worth jobs
  - unsupported job failure
  - no direct canonical memory mutation
  - output artifact paths recorded

### Remaining gaps

`meta_consolidation` and `vault_promotion_candidates` remain typed but unsupported in the background runner because they need more careful review-boundary UX.

## Track 3 — Codebase evidence command

### What changed

Added:

```text
/memory-evidence add-codebase-analysis --tool <tool> --command "<command>" --exit-code <code> --analysis-kind <kind> [--file <path>] [--symbol <name>] [--summary "<summary>"]
```

The command validates tool and analysis kind, redacts secret-like values, writes an `EvidenceRecord` with `source_kind: "codebase_analysis"`, and does not promote or mutate durable memory. Evidence polarity is `supports` for exit code `0` and `qualifies` for non-zero exit codes.

### Command examples

```bash
/memory-evidence add-codebase-analysis --tool tsc --command "bun run typecheck" --exit-code 0 --analysis-kind typecheck --summary "typecheck passed"
/memory-evidence add-codebase-analysis --tool eslint --command "bun eslint ." --exit-code 1 --analysis-kind lint --file src/index.ts
/memory-evidence add-codebase-analysis --tool playwright --command "bun playwright test" --exit-code 0 --analysis-kind e2e
/memory-evidence add-codebase-analysis --tool fallow --command "fallow analyze" --exit-code 0 --analysis-kind dead_code
```

### Tests

- `test/unit/memory-evidence-command.test.ts`
  - valid command creates evidence
  - invalid tool rejected
  - invalid analysis kind rejected
  - command/summary redaction
- `test/unit/codebase-evidence.test.ts`
  - evidence serialization/deserialization
  - candidate support without review bypass
  - Recall X-ray displays `codebase_analysis`

### Remaining gaps

No blocking gaps. Future work can add a tool form for linking the created evidence ID directly to a proposed candidate.

## Track 4 — Memory-worth integration expansion

### What changed

Memory-worth scoring now affects two additional candidate-producing paths:

1. Session consolidation (`src/consolidator.ts`)
2. Context compaction (`src/context-compaction.ts`)

Low-value observations are rejected before inbox persistence. Ambiguous important observations become inquiries. Explicit user instructions and durable workflow/testing observations remain candidates.

### Integrated paths

- Manual long-term capture: already implemented in Sprint 0.10.
- Session consolidation: now scores extracted raw candidates before inbox insertion.
- Context compaction: now scores observations after evidence creation but before durable candidate insertion.

### Tests

- `test/unit/consolidator.test.ts`
  - trivial consolidation candidate rejected
  - ambiguous important consolidation candidate creates inquiry
  - explicit workflow/testing candidate remains candidate with worth metadata
- `test/unit/context-compaction.test.ts`
  - candidate receives worth metadata
  - ambiguous important observation creates inquiry
  - low-trust compaction still routes to review
- Existing `test/unit/memory-worth.test.ts`

### Remaining gaps

Reinforcement-derived candidates and procedure-candidate ranking can use worth scoring in a later sprint. This follow-up covers the two highest-impact candidate paths without weakening review boundaries.

## Track 5 — Replay evals

### What changed

Added replay-style deterministic evals that simulate multi-step memory accumulation and later recall/worth behavior.

### Scenarios

- `replay_project_convention_recall`
  - Bun convention/correction is worth a candidate.
  - Later recall includes Bun convention.
  - Superseded npm suggestion is excluded as truth.
- `replay_negative_scope_exclusion`
  - LMS frontend-only memory is excluded in PI package context.
  - Recall X-ray explains the exclusion.
- `replay_codebase_evidence_support`
  - `tsc --noEmit` codebase evidence supports a memory.
  - Recall X-ray displays `codebase_analysis`.
  - Evidence does not auto-select a patch op.
- `replay_memory_worth_rejection`
  - Trivial observation is rejected/daily-only and does not create a durable candidate.
- `replay_background_job_no_mutation`
  - Background jobs produce artifacts without changing canonical memory count.

### Results

`bun run eval` passed 33/33 categories, including all hard invariants.

### Remaining gaps

Replay scenarios are deterministic and synthetic. Future benchmark work can add larger captured-session replays.

## Governance invariants checked

| Invariant | Status | Evidence |
|---|---|---|
| No automatic L1 promotion | Preserved | Existing meta-consolidation and governance tests/evals pass |
| No automatic skill writing | Preserved | Procedure candidate tests pass; export metadata remains review-only |
| Patch-before-mutation preserved | Preserved | Store-boundary, curator, patch, and auto-curation tests pass |
| Secret redaction preserved | Preserved | Secret scanner, Recall X-ray, codebase command, and report tests pass |
| Tombstones respected | Preserved | Delete/tombstone/verifier tests and X-ray tests pass |
| Privacy purge respected | Preserved | Privacy-purge delete tests pass |
| Background jobs do not directly mutate memory | Preserved | Background tests and replay eval hard invariant pass |
| Codebase evidence does not bypass review | Preserved | Codebase evidence tests and eval hard invariant pass |
| Memory-worth does not silently discard important corrections | Preserved | Explicit correction/workflow candidates remain candidates; ambiguous important observations create inquiries |

## Verification results

| Command | Result | Notes |
|---|---|---|
| `bun run typecheck` | Pass | `tsc --noEmit` completed with exit 0 |
| `bun test` | Pass | 331 pass, 0 fail, 804 assertions |
| `bun run eval` | Pass | 33/33 eval categories passed |
| `bun run build` | Unavailable | No `build` script exists; command fails with `Script not found "build"` |
| `npm pack --dry-run` | Pass | Dry-run package succeeded; package version unchanged at 0.9.0 |

## Package dry-run result

`npm pack --dry-run` succeeded for `pi-persistent-intelligence@0.9.0`.

- Total files: 86
- Package size: 146.9 kB
- Unpacked size: 537.5 kB
- Test files: not included
- Runtime/private memory/report artifacts: not included
- New public docs: included intentionally under `docs/`
- Package version: unchanged (`0.9.0`)

## Compatibility notes

- No package version bump.
- Existing records remain compatible because all new fields are optional.
- `MemoryWorthDecision` fields on candidates are additive.
- `codebase_analysis` metadata is optional on evidence records.
- Background queue stores state under runtime artifacts and does not alter canonical memory stores.
- Strict governance mode remains stricter than compatibility mode.

## Risks and limitations

- Recall X-ray hard-rule attribution is deterministic and policy-based; it does not yet explain every possible future semantic/hybrid ranking signal.
- Background `meta_consolidation` and `vault_promotion_candidates` are still unsupported as jobs until their review UX is more explicit.
- `/memory-evidence add-codebase-analysis` creates evidence only; candidate linking remains a separate manual/review path.
- Replay evals are synthetic and should be expanded with real session replays before making benchmark claims.

## Recommended release decision

Ready to integrate into main and prepare 0.10.0.

## Recommended next sprint

- Add evidence-to-candidate linking UX for codebase analysis.
- Add background `meta_consolidation` with explicit review-only artifact boundaries.
- Add real captured-session replay fixtures for recall/worth benchmarks.
- Add richer X-ray attribution for hybrid/semantic search once retrieval exposes source scores.

## Final verdict

Release-candidate quality for 0.10.0 preparation. Do not publish from this worktree until integrated/reviewed on main and versioning is decided explicitly.
