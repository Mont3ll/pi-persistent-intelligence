# Changelog

All notable changes to this project will be documented in this file.

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
- `docs/dogfood-checklist.md` for end-to-end manual verification
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
