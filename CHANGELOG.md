# Changelog

All notable changes to this project will be documented in this file.

## [0.6.0] - 2026-05-13

### Added

**Memory governance**
- Canonical JSONL memory store: L1 (identity), L2 (playbooks), L3 (daily session context)
- Patch-governed mutation: every durable change writes a patch file before touching canonical JSONL; full audit trail
- Inbox candidate system: `memory_write target=long_term` captures to inbox; curation promotes to L2
- Deterministic curator: promotes eligible candidates to L2 with explicit evidence, confidence, stability, review cadence, and change conditions
- Deterministic maintainer: confidence-decay patches for overdue records
- Supersession detection: explicit `supersedes:<id>` tags and heuristic contradiction-cue matching with overlapping-tag scoring
- Jaccard deduplication on consolidation: skips candidates with ≥ 0.7 token overlap against existing inbox and active records

**Rule type taxonomy**
- `MemoryRuleType` union with 9 categories: `workflow`, `preference`, `convention`, `architecture`, `avoid_pattern`, `prefer_pattern`, `testing`, `correction`, `tool`
- All `MemoryRecord` and `CaptureCandidate` types carry an optional `ruleType` field (backward compatible with records written without it)
- Curator propagates `ruleType` from candidate to promoted L2 record

**Automatic correction capture**
- Detects correction signals in user messages at conversation end (`agent_end`): "don't use X", "prefer Y over Z", "always/never use X", "this project uses X", etc.
- Infers `ruleType` from the correction pattern: `avoid_pattern`, `prefer_pattern`, `convention`, or `correction`
- Confidence-gated: strong corrections (≥ 0.85) become auto-eligible; medium (0.65–0.84) held for `/curate-memory`; below threshold ignored
- Jaccard dedup prevents the same correction from being captured across sessions

**Tiered auto-curation**
- `curator.autoCurate`: `"high-only"` (default), `"all-eligible"`, or `"off"`
- `"high-only"` auto-applies ops with confidence ≥ `autoCurateHighThreshold` (0.85) at session end after consolidation
- L1 writes and supersede ops never auto-applied regardless of mode
- Inbox review panel shown at next session start when pending candidates ≥ `inboxPromptThreshold` (default 3)

**Inbox review panel**
- Same component and controls as `/curate-memory` (PatchReviewPanel)
- `[r]` schedules `/curate-memory` as a follow-up after the current agent turn using `pi.sendUserMessage`
- `[a]` applies auto-eligible ops; `[s]` / Esc dismisses without changes
- Shown before the first agent turn using the per-turn `ctx` from `before_agent_start` (not stale session context)

**Hard rules injection**
- `extractHardRules()`: selects high-confidence (≥ 0.85) typed correction records
- Injected above Selected Memory with strong prefixes: `⚠️ AVOID:`, `✓ PREFER:`, `📌 RULE:`
- Distinguishes durable corrections from soft preferences in the context block

**Injection filter**
- `shouldInjectMemoryContext()`: skips trivial prompts (single-word acknowledgements, slash commands, very short inputs)
- Prevents noisy context injection when the user types "ok" or "thanks"

**Built-in FTS5 memory search**
- `MemoryFtsIndex`: SQLite FTS5 via `bun:sqlite` (always available, no Node 24 dependency, no external tools)
- Porter stemming, BM25 ranking over statement + tags + ruleType
- `memory_search mode=keyword` uses FTS directly; `mode=semantic` and `mode=deep` delegate to qmd
- FTS index synced after every canonical mutation

**Hybrid RRF search**
- `mergeHybridResults()`: Reciprocal Rank Fusion combining FTS (weight 0.45) and qmd semantic (weight 0.55)
- Items ranking well in both signals score highest
- Falls back gracefully: hybrid → FTS-only → term-match

**`/memory-learnings` TUI panel**
- Interactive table for browsing and managing L2 memory records
- Columns: layer, ruleType, confidence, staleness indicator, statement
- `↑↓` navigate, `e` expand full record detail, `d` deprecate record, `q` close
- Staleness warnings: ⚠️ (30 days+), 🔴 (90 days+)

**Session search (built-in, no Node 24)**
- `session_search`, `session_list`, `session_read`, `session_decisions` tools
- BM25 keyword over a local JSONL session index
- Semantic mode via qmd over exported session markdown summaries
- `#decision` extraction: `session_decisions` surfaces past `#decision` markers, cross-referenced with PI memory inbox candidates by date
- File-watch on sessions directory (2-second debounce) with 5-minute interval fallback
- Disabled automatically in subagent children (`PI_SUBAGENT_DEPTH > 0`, `!stdin.isTTY`)

**KV-cache-friendly context injection**
- Memory injected as a per-turn custom message (`customType: "pi-persistent-intelligence-context"`, `display: false`)
- Does not mutate `systemPrompt` — preserves provider KV-cache prefix (10× cost savings on cache-hit turns)
- Dynamic budget (14 KB default): hard rules → L1 → scratchpad → L2 → daily digest
- Staleness warnings on injected records: ⚠️ (30 days+), 🔴 (90 days+) with age in days

**LLM consolidation at session end**
- `pi --print` subprocess extracts durable patterns from the conversation at shutdown
- Adds candidates to inbox; requires `/curate-memory` or tiered auto-curation before entering canonical memory
- Jaccard dedup (0.7 threshold) prevents duplicate candidates across sessions
- Model configurable via `PI_MEMORY_CONSOLIDATION_MODEL`

**Settings.json localPath cascade**
- `resolveRoot(cwd)` reads `{cwd}/.pi/settings.json` for `pi-persistent-intelligence.localPath` and `pi-pi.localPath` (alias)
- Root resolved per-session; project-local memory fully isolated from global store

**Vault integration**
- `vault_ref` field on memory records
- `promote_to_vault_candidate` patch op
- `vault_ref` auto-suggestions during curation when `PI_VAULT_PATH` is set
- Vault-promotion report generation under `reports/`
- `memory-governance` companion skill

**Dual-registry publish**
- `.github/workflows/publish.yml`: triggered on `v*` tag push
- Publishes to `registry.npmjs.org` (npm ecosystem, pi.dev) and `npm.pkg.github.com` (GitHub Packages tab)
- Both jobs gated on CI passing

**Other**
- 138 passing tests
- Interactive patch review TUI (PatchReviewPanel) with keyboard navigation, inline editing, and risk badges
- Legacy `MEMORY.md` migration importer with quality scoring
- `/memory-doctor` showing FTS status, session count, auto-curation mode, vault path, inbox count
- Project identity inference from nearest `package.json`, `.git`, or cwd basename
- qmd integration: three contexts (`rendered/`, `daily/`, `sessions/summaries/`)
