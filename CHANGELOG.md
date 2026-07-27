# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Added deterministic natural-language capture for direct user preferences, corrections, repository conventions, and reusable workflows.
- Added bounded repository activity attribution, per-turn checkpoints, recurrence reinforcement, multi-project candidate groups, and positive applicability filtering.
- Added report-only capture quality and historical audit commands plus fingerprinted, backed-up, candidate-only backfill.

### Changed

- Direct global preferences now become review-only L2 candidates instead of depending on session-end consolidation or launch-directory scope.
- Global preferences are recalled only for positively matching task contexts while the 14 KB default context budget remains unchanged.
- Memory Inbox and Memory Curator now share restrained colors, spacing, navigation language, and width-safe rendering.

## [0.14.0] - 2026-07-24

### Added

- Added dry-run-first `/memory-store-integrity` repair with reviewed fingerprints, mandatory backups, and audit reports.
- Added duplicate stable-ID and self-supersession diagnostics.
- Added report-only `/memory-reconcile` with deterministic eight-section peer comparison.
- Added opaque generic peer-event persistence for lossless non-redacted round trips.
- Added reviewed legacy evidence backfill, explicit inquiry lifecycle/staleness commands, and explicit positive reinforcement.
- Added evidence adoption, inquiry age-band, and reinforcement distribution quality reporting.

### Changed

- Patch skips now include structured reasons and details; zero-applied patches use `rejected_at_apply`.
- Project/profile exports now filter related artifacts without relabeling global/domain records or unscoped sessions.
- Automatic correction capture now rejects task/agent wrappers and routes through durability and memory-worth classification.
- Implicit success now requires a uniquely selected active memory and an observable successful test/tool outcome; neutral exposure is disabled by default.

### Fixed

- Privacy purge now redacts correlated historical capture candidates and embedded patch payloads, including safe reruns after the canonical record was already purged.
- Prevented exact duplicate stable IDs from entering canonical memory.
- Preserved domain scope across JS/Rust imports and exports.
- Restored full `pi-governance` bundle interoperability with Rust v1.1.0: RFC 3339 timestamp normalization, native Rust patch import, auxiliary artifact preservation, ID-based deduplication, and import backups.

## [0.13.0] - 2026-07-09

### Added

- Added `/memory-relationship-quality` for report-only analysis of memory graph edges, orphan/dead-end memories, hubs, and weak relationship links.
- Added `/memory-store-quality` for aggregate report-only store health across memory quality, relationship quality, recall effectiveness, governance, inbox, and runtime signals.
- Added recall effectiveness telemetry and `/memory-recall-effectiveness` for reviewing selected, excluded, never-recalled, and correction-adjacent memories.
- Added `/memory-simulate-patch` to preview patch effects on memory, relationship, and store-quality scores without applying mutations.
- Added relationship-quality and store-quality background analysis job kinds.

### Changed

- Reused preloaded memory graph/context data in health and relationship-quality analysis to reduce repeated store reads.
- Improved session consolidation model selection: consolidation now prefers `PI_MEMORY_CONSOLIDATION_MODEL`, then the current Pi session model, then the Pi CLI default without forcing a hard-coded model.
- Updated public command and configuration docs for the new quality, recall, simulation, and consolidation behavior.

### Fixed

- Fixed silent session-consolidation failures by returning failure metadata, writing runtime events, and adding daily-log `Consolidation skipped` entries when consolidation cannot run.

### Governance

- Quality, relationship, recall, store, and patch-simulation reports remain review-only and do not mutate durable memory.
- Governance simulation does not apply patches or write canonical memory stores.
- Recall telemetry is operational runtime data and does not bypass patch-governed durable memory flows.
- No automatic L1 promotion, skill writing, vault mutation, or durable mutation bypass was added.

### Quality checks

- `bun run typecheck`
- `bun test`
- `bun run eval`
- `bun run test:stress`
- `npm pack --dry-run`

## [0.12.0] - 2026-06-30

### Added

- Added shared PI memory contract documentation.
- Added pi-governance-rs compatibility documentation.
- Added pi-governance-compatible export bundle support.
- Added pi-governance-compatible import/dry-run support.
- Added optional pi-governance-rs bridge configuration.
- Added `/memory-governance doctor` for checking optional Rust runtime compatibility.
- Added schema/status/layer mapping tests.

### Changed

- Aligned public terminology with the shared PI memory contract: namespace, layer, memory_kind, rule_type, trust_class, durability, source_kind, verification, proposed/applied/rejected/deferred.
- Clarified standalone mode versus optional shared global governance mode.
- Clarified that pi-governance-rs owns the MCP server for non-pi and multi-agent usage.

### Governance

- pi-persistent-intelligence remains standalone.
- No MCP server was added to this JavaScript package.
- No dependency on pi-governance-rs was introduced for normal pi-agent use.
- No automatic L1 promotion was added.
- No durable mutation bypass was added.
- Imports are dry-run/merge-safe unless explicitly applied through governed flows.
- No hosted service, database, vector store, graph database, dashboard, connector, or cloud sync was added.

### Quality checks

- `bun run typecheck`
- `bun test`
- `bun run eval`
- `bun run test:stress`
- `npm pack --dry-run`
- pi-governance compatibility fixture, if available

## [0.11.2] - 2026-06-19

### Added

- Added post-mutation integrity checks for patch/delete/privacy-purge consistency.
- Added runtime-event reporting for post-mutation inconsistencies.
- Added privacy-validated replay fixtures for internal memory-behavior validation.

### Changed

- Extended replay validation to distinguish synthetic, captured-style synthetic, and redacted-real fixtures.
- Improved mutation safety observability without changing the patch-governed mutation model.

### Governance

- Post-mutation checks are diagnostic only and do not bypass patch-before-mutation.
- Replay fixtures do not contain raw private sessions.
- Privacy-purged content remains excluded from normal memory files and recall.
- No automatic L1 promotion, skill writing, vault mutation, or durable mutation path was added.

### Quality checks

- `bun run typecheck`
- `bun test`
- `bun run eval`
- `bun run test:stress`
- `npm pack --dry-run`

## [0.11.1] - 2026-06-15

### Fixed

- Fixed hard-rule counting used by injection stats and Recall X-ray context-budget diagnostics.
- Removed duplicate record loading in the context-injection path.
- Removed stale hardcoded README test/eval counts.

### Changed

- Reduced semantic qmd use in context injection to an opportunistic, budgeted path.
- Split L1/L2 selected-memory budgets so L1 records cannot starve task-specific L2 playbooks by default.
- Added per-section injection caps to prevent any one context section from monopolizing the injection budget.
- Added injection timing stats for diagnostics.
- Added runtime health events for recoverable failures and slow/failed background jobs.
- Hardened background queue execution with lockfile protection and stale-running recovery.

### Quality checks

- `bun run typecheck`
- `bun test`
- `bun run eval`
- `npm pack --dry-run`

## [0.11.0] - 2026-06-15

### Added

- Added `/memory-evidence link <evidence-id> --statement "..."` for turning existing evidence records into review-required memory candidates without directly mutating durable memory.
- Added context budget diagnostics to Recall X-ray, including selected/omitted counts, omission reasons, and approximate context-size reporting.
- Added score provenance to Recall X-ray for available FTS, semantic, and hybrid/RRF retrieval metadata.
- Added reversible compaction metadata, including source identifiers, original digests, compression method, reversibility flags, and diagnostics for traceability.
- Added a replay fixture framework with redaction checks and synthetic captured-style starter fixtures.
- Added confidence computation/audit helpers to ensure user- or model-provided confidence cannot bypass trust/evidence constraints.
- Added `docs/wiki/conflict-resolution-policy.md`.
- Added `docs/wiki/governance-regressions.md`.
- Added `/memory-skill draft <procedure-candidate-id>` for review-gated skill draft artifacts from procedure candidates.
- Added `/memory-failures analyze [--save]` for review-only failure-analysis candidates and reports.
- Added review-only background runners for meta-consolidation and vault-promotion candidate workflows.

### Changed

- Expanded Recall X-ray from recall explanation into retrieval/context-budget transparency.
- Improved context compaction traceability.
- Strengthened package/report hygiene around sprint reports, eval reports, replay fixtures, and runtime artifacts.
- Expanded docs-contract coverage for command registration, wiki links, and package-file policy.
- Expanded deterministic eval coverage for evidence linking, context budget diagnostics, reversible compaction, replay redaction, score provenance, confidence boundaries, skill draft export, failure analysis, and background review-only runners.

### Governance

- Evidence linking creates review-required candidates only.
- Skill draft export never writes `SKILL.md` or `skills/**` automatically.
- Failure analysis is review-only.
- Background meta-consolidation and vault-promotion jobs are report/candidate-only.
- Codebase-analysis evidence remains supporting evidence and does not bypass review.
- Reversible compaction does not expose privacy-purged content.
- Replay fixtures are redacted and do not include raw private sessions.
- No automatic L1 promotion was added.
- No hosted service, database, vector store, or graph database dependency was added.

### Quality checks

- `bun run typecheck`
- `bun test`
- `bun run eval`
- `npm pack --dry-run`

### Notes

- `bun run build` remains unavailable because this package has no build script.
- The replay fixture framework includes synthetic captured-style fixtures unless explicitly documented otherwise. Do not treat them as public benchmarks.

## [0.10.0] - 2026-06-13

### Added

- Added `/memory-recall-xray <query>` for read-only recall explanations, including included/excluded memory reasoning, scope filters, evidence status, trust class, memory kind, and hard-rule attribution.
- Added memory-worth scoring with `reject`, `daily_only`, `candidate`, and `inquiry` decisions.
- Added `/memory-background enqueue|run|list` for local report-producing background analysis jobs.
- Added background runners for diagnostics, provenance liveness, re-verification, memory graph, memory timeline, procedure candidates, and memory-worth review.
- Added optional `memory_kind` taxonomy: `fact`, `event`, `instruction`, and `task`.
- Added `codebase_analysis` evidence metadata for deterministic tool output.
- Added `/memory-evidence add-codebase-analysis` for safe codebase evidence capture.
- Added Retain/Recall/Reflect documentation.
- Added docs-contract tests for command, config, package, and package-file drift.
- Added replay-style evals for project convention recall, negative-scope exclusion, codebase evidence support, memory-worth rejection, and background-job no-mutation.

### Changed

- Integrated memory-worth scoring into manual long-term capture, session consolidation, and context compaction.
- Enriched procedure candidates with review-only export boundary metadata.
- Improved diagnostics and recall reporting with memory kind and evidence source visibility.
- Updated README and wiki docs for recall transparency, background operations, and deterministic codebase evidence.

### Governance

- Preserved patch-before-mutation.
- Preserved strict and compatibility governance modes.
- Preserved secret scanning and redaction.
- Preserved tombstone and privacy-purge behavior.
- Preserved contested-memory warning-only behavior.
- Background jobs do not directly mutate durable memory.
- Codebase-analysis evidence supports review but does not bypass governance.
- Procedure candidates remain review-only and do not auto-write skills.

### Quality checks

- `bun run typecheck`
- `bun test`
- `bun run eval`
- `npm pack --dry-run`

### Notes

- No hosted service dependency was added.
- No database, vector store, or graph database dependency was added.
- `bun run build` is not available because this package has no build script.

## [0.9.0] - 2026-06-02

### Added

- Secret scanning before long-term candidate and evidence persistence, with high-confidence secret blocking and report redaction
- `/memory-graph [--save]` for read-only dependency graph export across memories, evidence, inquiries, tombstones, candidates, and reinforcement events
- `/memory-timeline [--memory <id>] [--save]` for effective validity and audit timeline reporting
- Provenance liveness checks in diagnostics for missing source files and invalidated evidence
- Dependency-based re-verification recommendations in diagnostics
- Goal handoff mode via `/memory-handoff --goal <goal>`
- Optional temporal validity fields on memory records: `valid_from`, `valid_to`, `invalidated_by`, and `validity_reason`
- `retrieval.injectionMode` with `scoped`, `policy_only`, and `wakeup` modes
- Runtime injection stats surfaced through diagnostics
- `/procedure-candidates [--save]` for review-only procedure drafts from repeated workflow memory

### Changed

- Patch application now re-checks conflicts at apply time and skips stale unsafe operations instead of blindly applying them
- Diagnostics now redacts high-confidence secret-like values in rendered output
- Automatic correction capture ignores task and subagent prompt wrappers to reduce false-positive inbox candidates

## [0.8.0] - 2026-05-20

### Added

**Governed memory architecture**
- Canonical JSONL memory store with L1 (identity), L2 (playbooks), and L3 (daily session context) layers
- Markdown projections rendered from JSONL; projections are never the source of truth
- Patch-governed mutation: every durable change writes a patch file before touching canonical JSONL
- Profile/resource/thread identity: memory records and candidates are profile-scoped; cross-profile injection is hard-blocked
- Processor pipeline with `StatusFilterProcessor`, `ProfileScopeProcessor`, `BasicScopeProcessor`, and `NegativeScopeProcessor`; each processor emits exclusion traces
- Normalized memory keys for duplicate detection, conflict detection, and supersession matching
- Candidate matching: 7 match kinds (`new`, `duplicate`, `strengthens_existing`, `updates_existing`, `potential_conflict`, `supersedes_existing`, `ambiguous`)
- Contested status, exception fields (`applies_when`, `does_not_apply_when`, `known_exceptions`), and patch ops `contest`, `uncontest`, `add_exception`
- Store write boundary: public `addMemoryRecord()` enforces patch-apply context; `unsafeAddMemoryRecord()` is available for setup and test use

**Evidence, trust, and verification**
- `EvidenceRecord` with content-addressed IDs, bounded source excerpts, trust classes, and durability signals
- 11-class trust hierarchy from `direct_user_instruction` to `third_party_documentation`
- Promotion eligibility derived from trust class and durability; low-trust and temporary candidates route to review
- Poisoning risk inference: repository text and generated content flagged and blocked from auto-apply
- Deterministic candidate verifier: source support, durability, trust boundary, conflict risk, redacted evidence, tombstone re-creation prevention

**Strict governance mode**
- `governance.mode = "strict"` in config requires trust metadata and verified status before auto-apply
- Default remains `"compatibility"` for full backward compatibility with existing records

**Deletion and forgetting**
- `audit_preserving` delete: marks record as deleted; removes from injection and FTS; preserves audit trail
- `privacy_purge` delete: redacts statement, purges linked evidence content, writes content-free tombstone
- `applyPatchAndSync()` public helper: applies patch and syncs FTS atomically for delete flows
- Tombstones prevent re-promotion through any candidate path

**Reinforcement and maintenance**
- `ReinforcementEvent` with outcome weights (`explicit_reinforcement`, `implicit_success`, `neutral_exposure`, `explicit_correction`)
- `summarizeReinforcement()` with conservative weighting; one explicit correction outweighs many implicit successes
- Reinforcement-based maintenance recommendations: `decrease_stability`, `increase_stability`, `review_memory`
- `/maintain-memory --report` surfaces stability recommendations without auto-mutation
- `update_stability` patch op for governed stability changes

**Inquiry records**
- `InquiryRecord` with open/answered/withdrawn/stale lifecycle
- Deterministic deduplication by normalized question and profile
- Relevant inquiry selection capped at 3; answered and stale records not surfaced
- Ambiguous and conflict candidates automatically create open inquiries

**Context-compaction consolidation trigger**
- `runContextCompactionConsolidation()` creates evidence records and verified candidates from observations before context is lost
- Does not directly mutate L1 or L2 memory

**Memory diagnostics**
- `/memory-diagnostics [--save]` command checks store integrity: orphan evidence, tombstoned-in-active, contested-in-hard-rule path, deleted-in-rendered-Markdown, legacy missing fields, duplicate normalized keys, active records referencing redacted evidence
- Severity levels: `ok`, `info`, `warning`, `error`
- Clean generated store reports zero errors (verified in eval suite)

**Contested memory warning injection**
- When context-relevant contested records exist, a warning-only section is injected below regular memory
- Contested records are never placed under `## Hard Rules`
- Capped at 2 records; marked `CONTESTED` with review-before-relying warning

**Meta-consolidation reports**
- `/meta-consolidation [--handoff]` clusters stable active L2 records within a single profile
- Performs mandatory counterexample search (contested records, tombstones, open inquiries, redacted evidence)
- Generates review-only L1 candidates; never mutates L1 directly
- Reports written to `reports/meta-consolidation/`

**Handoff snapshots**
- `/memory-handoff` generates a snapshot of active memory, open inquiries, contested records, and pending candidates
- Background reference only; canonical persistent memory remains authoritative
- Reports written to `reports/handoff/`

**Eval suite**
- `bun run eval`: 14-category deterministic eval harness with 7 hard invariants
- Hard invariants: trust boundary, profile leakage, deletion/forgetting, inquiry cap, context-compaction, meta-consolidation safety, diagnostics clean store, contested-not-in-hard-rules
- All categories and invariants pass before release

**Correction detection improvements**
- Durable-intent phrase patterns added: "going forward, prefer X before Y", "from now on, always use X", "in the future, prefer..."
- Temporal "before" without durable-intent prefix remains correctly not detected

**Documentation**
- Revised README with lifecycle diagram, accurate command and tool tables, governance mode docs, evidence/trust/verification section, deletion section, diagnostics section, contested injection section, meta-consolidation section, safety guarantees table, and limitations
- `governance.mode` documented with compatibility and strict behavior
- Meta-consolidation manual/off-by-default noted
- L1 never auto-applies stated in multiple places

### Changed

- `/maintain-memory` now also generates reinforcement-based stability recommendations in addition to time-based decay
- `/memory-patches` and `/apply-memory-patch` commands implemented (were documented but unregistered in earlier versions)
- `/memory-inbox` command implemented (was documented but unregistered in earlier versions)
- FTS sync added immediately after session-end auto-curation patch application

### Fixed

- `loadLayerRecords()` documented to clarify it returns all records including deleted (for audit trail); callers who need only active records should use `loadActiveRecords()`
- `applyPatchAndSync()` added as safe public helper for delete and privacy-purge flows requiring immediate FTS consistency

---

## [0.7.0] - 2026-05-13

### Added

- Canonical JSONL memory store with L1 and L2 layers
- Patch-governed mutation with full audit trail
- Inbox candidate system with tiered auto-curation
- Deterministic curator with ruleType propagation
- Deterministic maintainer with confidence-decay patches
- Supersession detection
- Jaccard deduplication on consolidation
- Rule type taxonomy: 9 categories
- Automatic correction capture from user messages
- Tiered auto-curation with configurable thresholds
- Inbox review panel with keyboard navigation
- Hard rules injection with priority prefixes
- Injection filter for trivial prompts
- Built-in FTS5 memory search via `bun:sqlite`
- Hybrid RRF search combining FTS and qmd semantic
- `/memory-learnings` interactive TUI panel
- Built-in session search with BM25 keyword ranking
- KV-cache-friendly context injection
- LLM consolidation at session end
- Settings.json project-local storage cascade
- Vault integration with vault_ref field and promotion reports
- Dual-registry publish workflow (npmjs.com and GitHub Packages)
- 138 passing tests
