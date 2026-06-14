# PI Sprint 0.10 — Recall Transparency and Background Memory Operations

Date: 2026-06-13
Branch/commit: `sprint-010-recall-transparency` at base commit `69d6c45bf8208fd457d18aefc5e63362547e9052` with uncommitted sprint changes
Runtime: Bun 1.3.13, Node v24.15.0, npm 11.12.1
Package version before: 0.9.0
Package version after, if changed: 0.9.0 (unchanged)

## Executive summary

Implemented the Sprint 0.10 foundation for recall transparency and background memory operations while preserving PI's governed-memory identity. The sprint adds read-only recall X-ray reports, memory-worth scoring before manual long-term capture, a local background-analysis queue, an optional `memory_kind` taxonomy, deterministic `codebase_analysis` evidence metadata, docs-contract tests, Retain/Recall/Reflect documentation, explicit procedure export-boundary metadata, and eval categories for the new governance paths.

The implementation remains local-first and does not add external services or hosted dependencies. Durable memory mutation remains patch-governed. L1 auto-promotion and automatic skill writing remain blocked.

## Current verdict

implemented and verified

## Borrowed design patterns

| Source | Borrowed idea | PI adaptation | Implemented? |
|---|---|---|---|
| Remnic | Recall X-ray, memory-worth scoring | `/memory-recall-xray`, `scoreMemoryWorth()` and `memory_write` gating | Yes |
| Honcho | Background reasoning queues | Local `BackgroundAnalysisJob` queue under runtime artifacts; diagnostics runner first | Yes |
| Cloudflare Agent Memory | Facts, Events, Instructions, Tasks taxonomy | Optional `MemoryKind = fact/event/instruction/task` with inference for legacy records | Yes |
| AtomicMemory | Docs-contract checks | `test/docs/docs-contract.test.ts` checks README commands/config/package/package files | Yes |
| Fallow | Deterministic codebase evidence bundles | `source_kind: "codebase_analysis"` with tool/command/exit metadata | Yes |
| pi-hermes-memory | Curated procedure/skill boundary | Procedure candidates now carry export status and human-review metadata | Yes |
| AgentMemory/Hindsight | Retain/Recall/Reflect framing and eval discipline | `docs/retain-recall-reflect.md` and new deterministic eval categories | Yes |
| localmem | Temporal/background context refinement | Background jobs and recall diagnostics without silent mutation | Partially |

## Files changed

- `CHANGELOG.md`
- `README.md`
- `docs/PI-SPRINT-010-RECALL-TRANSPARENCY-BACKGROUND-OPS.md`
- `docs/dogfood-checklist.md`
- `docs/retain-recall-reflect.md`
- `docs/wiki/commands-and-tools.md`
- `docs/wiki/index.md`
- `docs/wiki/memory-model.md`
- `eval/run-evals.ts`
- `index.ts`
- `src/background-analysis.ts`
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
- `test/unit/memory-kind.test.ts`
- `test/unit/memory-worth.test.ts`
- `test/unit/procedure-export-boundary.test.ts`
- `test/unit/recall-xray.test.ts`

## Feature summary

- Added `/memory-recall-xray <query>` for read-only recall explanations.
- Added memory-worth scoring and applied it to manual `memory_write target=long_term` capture.
- Added `/memory-background enqueue <kind>`, `/memory-background run`, and `/memory-background list` with diagnostics as the first report-producing job.
- Added optional `memory_kind` and inference for legacy records.
- Added `codebase_analysis` evidence source metadata.
- Added docs-contract tests for README command/config/package/package-file drift.
- Added Retain/Recall/Reflect docs and updated public docs.
- Added procedure candidate export metadata without skill writing.
- Added six eval categories for the new governance behavior.

## Track 1 — Recall X-ray

### What changed

Created `src/recall-xray.ts` and registered `/memory-recall-xray <query>`. The report explains included and excluded memories after the same status/profile/basic-scope/negative-scope processor pipeline used by retrieval. It includes memory ID, layer, profile/resource/thread, memory kind, retrieval tier/score, included/excluded reason, evidence IDs/status/source kinds, trust class, contested/stale/tombstone/dependency-invalidated state, and scope/exception fields.

Output is read-only and redacted with the existing secret scanner.

### Example output

```text
PI Recall X-ray — bun test
Included: 1  Excluded: 2  Contested: 0  Stale: 0  Dependency-invalidated: 0  Tombstoned: 0

## Included
- mem_bun [L2, instruction] score=1 evidence=present sources=conversation: Matched query terms after policy filters — Use bun test before committing.

## Excluded
- mem_other: profile_mismatch:project:other (ProfileScopeProcessor)
```

### Tests

- `test/unit/recall-xray.test.ts`
- `test/unit/memory-kind.test.ts` integration assertion
- Eval: `recall_xray_scope_explanation`

### Remaining gaps

Hard-rule-specific retrieval tier is not yet separated from term/L1 retrieval in X-ray output. The report still identifies included records and policy exclusions, but future work can add explicit hard-rule source attribution.

## Track 2 — Memory-worth scoring

### What changed

Created `src/memory-worth.ts` with `MemoryWorthDecision = reject | daily_only | candidate | inquiry`. Added worth diagnostics to `CaptureCandidate` and `withMemoryWorth()` in `src/inbox.ts`. Manual `memory_write target=long_term` now:

- rejects trivial/duplicate/sensitive observations before persistence,
- routes temporary observations to the daily log,
- persists candidate/inquiry-worthy observations to the inbox with worth metadata.

### Decision model

The scorer uses deterministic signals: explicitness, recurrence, correction strength, operational impact, future reuse, specificity, scope clarity, evidence strength, sensitivity risk, and volatility.

### Tests

- `test/unit/memory-worth.test.ts`
- Existing curator/governance tests still pass with enriched candidates
- Eval: `memory_worth_rejects_trivial`, `memory_worth_inquiry_for_ambiguous`

### Remaining gaps

The scorer is integrated into manual long-term capture and candidate enrichment. Session-end LLM consolidation, context compaction, and reinforcement-derived candidate selection can use stricter worth gating in a later sprint.

## Track 3 — Background analysis queue

### What changed

Created `src/background-analysis.ts` with `BackgroundAnalysisKind`, `BackgroundAnalysisJob`, queue persistence under `runtime/background-analysis/jobs.json`, and a runner that supports diagnostics jobs. Added `/memory-background enqueue <kind>`, `/memory-background run`, and `/memory-background list`.

Jobs are local-first, inspectable, repeatable, and report-producing. They do not directly mutate durable memory.

### Job model

```ts
{
  id: string;
  kind: BackgroundAnalysisKind;
  created_at: string;
  status: "queued" | "running" | "succeeded" | "failed";
  output_artifact_path?: string;
  error?: string;
  warnings?: string[];
}
```

### Tests

- `test/unit/background-analysis.test.ts`
- Eval: `background_job_no_direct_mutation`

### Remaining gaps

Only diagnostics jobs run in this first implementation. Other kinds are typed and fail safely until implemented.

## Track 4 — Memory kind taxonomy

### What changed

Added `MemoryKind = fact | event | instruction | task`, optional `memory_kind` on records/candidates, `src/memory-kind.ts` for normalization/inference, diagnostics distribution reporting, recall X-ray display, and curation preservation from candidate to record.

### Compatibility

Legacy records without `memory_kind` remain valid. Reports infer a kind at read/report time.

### Tests

- `test/unit/memory-kind.test.ts`

### Remaining gaps

Inference is heuristic. Future work can tune kind inference from trust metadata and source context.

## Track 5 — Codebase-analysis evidence

### What changed

Extended `EvidenceSourceKind` with `codebase_analysis` and added `CodebaseAnalysisEvidenceMetadata` for deterministic tool output.

### Evidence model

```ts
{
  source_kind: "codebase_analysis";
  tool: "tsc" | "eslint" | "playwright" | "vitest" | "fallow" | "custom";
  command?: string;
  exit_code?: number;
  analysis_kind?: "typecheck" | "lint" | "test" | "e2e" | "dependency" | "dead_code" | "complexity" | "security" | "duplication" | "custom";
  timestamp: string;
}
```

Codebase-analysis evidence supports candidates and reports but does not bypass review.

### Tests

- `test/unit/codebase-evidence.test.ts`
- Eval: `codebase_evidence_no_bypass`

### Remaining gaps

No `/memory-evidence add-codebase-analysis` command yet. Types/tests/docs are in place.

## Track 6 — Docs-contract checks

### What changed

Added `test/docs/docs-contract.test.ts` to check:

- README slash commands map to registered commands,
- config examples use canonical camelCase keys,
- package name/version/install references remain consistent,
- package `files` excludes reports/tests/private memory fixtures.

### Tests

- `test/docs/docs-contract.test.ts`
- Eval: `docs_contract_command_config_sync`

### Remaining gaps

The test is intentionally pragmatic. It does not parse every README claim or validate every config value deeply.

## Track 7 — Retain/Recall/Reflect docs

### What changed

Added `docs/retain-recall-reflect.md` and linked it from the wiki index. Updated README with the Retain/Recall/Reflect positioning.

### Public positioning

PI is described as:

- **Retain**: capture useful candidates with evidence and memory-worth scoring.
- **Recall**: retrieve scoped memory with policy, trust, and diagnostics.
- **Reflect**: produce reviewable maintenance, abstraction, procedure, and promotion candidates.

### Remaining gaps

Future docs can add diagrams once the background queue supports more job kinds.

## Track 8 — Procedure candidate export boundary

### What changed

Procedure candidates now include:

```ts
{
  procedure_candidate_id: string;
  source_memory_ids: string[];
  evidence_ids: string[];
  suggested_skill_name?: string;
  export_status: "not_exported" | "review_required" | "approved" | "exported";
  requires_human_review: true;
}
```

Existing reports still do not write `SKILL.md`.

### Tests

- `test/unit/procedure-export-boundary.test.ts`
- Existing `test/unit/procedure-candidates.test.ts`

### Remaining gaps

No export command exists. The boundary is documented and typed; future export must require explicit approval.

## Track 9 — Evaluation and benchmark discipline

### What changed

Added eval categories:

- `recall_xray_scope_explanation`
- `memory_worth_rejects_trivial`
- `memory_worth_inquiry_for_ambiguous`
- `background_job_no_direct_mutation`
- `codebase_evidence_no_bypass`
- `docs_contract_command_config_sync`

README/report language avoids benchmark overclaiming.

### Tests/evals

`bun run eval` passed 28/28 categories.

### Remaining gaps

No external benchmark claims are made. Future benchmark discipline can add larger replay datasets.

## Governance invariants checked

| Invariant | Status | Evidence |
|---|---|---|
| No automatic L1 promotion | Preserved | Existing meta-consolidation/governance tests and eval hard invariant pass |
| No automatic skill writing | Preserved | `test/unit/procedure-export-boundary.test.ts`; `test/unit/procedure-candidates.test.ts` |
| Patch-before-mutation preserved | Preserved | Existing store-boundary/curator/patch tests pass |
| Secret redaction preserved | Preserved | Recall X-ray/codebase tests; secret scanner tests; report renderers redact |
| Tombstones respected | Preserved | Existing tombstone/delete/verifier tests pass; X-ray reports tombstoned exclusions |
| Privacy purge respected | Preserved | Existing delete/privacy purge tests pass |
| Background jobs do not directly mutate memory | Preserved | `test/unit/background-analysis.test.ts`; eval hard invariant |
| Codebase evidence does not bypass review | Preserved | `test/unit/codebase-evidence.test.ts`; eval hard invariant |

## Tests added or updated

Added:

- `test/docs/docs-contract.test.ts`
- `test/unit/background-analysis.test.ts`
- `test/unit/codebase-evidence.test.ts`
- `test/unit/memory-kind.test.ts`
- `test/unit/memory-worth.test.ts`
- `test/unit/procedure-export-boundary.test.ts`
- `test/unit/recall-xray.test.ts`

Updated:

- `eval/run-evals.ts`

## Verification results

| Command | Result | Notes |
|---|---|---|
| `bun run typecheck` | Pass | `tsc --noEmit` completed with exit 0 |
| `bun test` | Pass | 324 pass, 0 fail, 759 assertions |
| `bun run eval` | Pass | 28/28 eval categories passed |
| `bun run build` | Unavailable | Package has no `build` script; command failed with `Script not found "build"` |
| `npm pack --dry-run` | Pass | Dry-run package: 85 files, package version 0.9.0, no reports/tests/private memory included |
| Subagent review | Pass after fix | Reviewer found one important issue; fixed memory-kind curation propagation; re-review found no blockers |

## Compatibility notes

- Package version was not changed.
- `memory_kind`, worth metadata, and codebase-analysis metadata are optional.
- Old records and candidates still load.
- Compatibility governance mode remains compatible.
- Strict governance mode remains strict.
- Background queue is additive and stores status under runtime artifacts.

## Risks and limitations

- Recall X-ray uses deterministic term scoring and policy traces; it is not a full vector-search explanation layer.
- Background queue supports diagnostics first; other job kinds are typed but not implemented.
- Memory-worth scoring is deterministic and conservative, but it is a heuristic and should be tuned with dogfooding.
- Codebase-analysis evidence has types and tests but no dedicated command yet.
- Docs-contract tests cover obvious drift, not every public statement.

## Recommended next sprint

- Add explicit hard-rule tier attribution to Recall X-ray.
- Extend background jobs for provenance liveness, re-verification, memory graph, timeline, procedure candidates, and memory-worth review.
- Add `/memory-evidence add-codebase-analysis` with safe input validation.
- Wire memory-worth scoring into session-end consolidation and context-compaction candidate generation.
- Add larger replay-style recall/eval scenarios for benchmark discipline.

## Final verdict

Implemented and verified with minor planned follow-ups. Governance invariants remain preserved.
