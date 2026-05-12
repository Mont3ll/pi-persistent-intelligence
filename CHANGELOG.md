# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-05-12

### Added

**Memory**
- Canonical JSONL memory store: L1 (identity), L2 (playbooks), L3 (daily session context)
- Patch-governed mutation: every durable change writes a patch file before touching canonical JSONL
- Inbox candidate system: `memory_write target=long_term` captures to inbox; curation promotes to L2
- Deterministic curator: promotes eligible candidates to L2 with explicit evidence, confidence, stability, review cadence, and change conditions
- Deterministic maintainer: generates confidence-decay patches for overdue records
- Supersession detection: explicit `supersedes:<id>` tags and heuristic contradiction-cue matching
- Jaccard deduplication on consolidation: skips candidates with ≥ 0.7 token overlap against existing inbox and active records

**Curation and auto-curation**
- Tiered auto-curation at session end: `"high-only"` (confidence ≥ 0.85, default), `"all-eligible"`, or `"off"`
- L1 writes and supersede ops are never auto-applied regardless of mode
- Inbox review overlay: floating TUI modal before the first agent turn when pending candidates ≥ threshold; `[a]` approve / `[r]` review / `[s]` skip; plain-text fallback for headless mode
- LLM consolidation at session end: `pi --print` subprocess extracts durable patterns and adds them to inbox

**Retrieval and injection**
- KV-cache-friendly context injection: per-turn custom message, not system prompt mutation
- Dynamic injection budget (14 KB default) with priority ordering: L1 → scratchpad → L2 → daily digest
- Staleness warnings: ⚠️ (30 days+) and 🔴 (90 days+) age indicators on injected records
- Structured daily log digest: extracts `#decision` markers and `##` headings instead of raw log tail
- Async qmd semantic injection selectivity with term-match fallback

**Session search (built-in, no Node 24 required)**
- BM25 keyword search over a JSONL session index; no SQLite FTS5, no external dependencies
- qmd semantic search over exported session markdown summaries (`mode=semantic`)
- `session_search`, `session_list`, `session_read`, `session_decisions` tools
- `session_decisions`: extracts `#decision` markers from past sessions
- File-watch on sessions directory (2-second debounce) with 5-minute interval fallback
- Disabled automatically in subagent children (`PI_SUBAGENT_DEPTH`, `!stdin.isTTY`)

**Configuration and paths**
- `config.json` with `autoCurate`, `autoCurateHighThreshold`, `inboxPromptThreshold`, vault settings
- `settings.json` localPath cascade: `pi-persistent-intelligence.localPath` and `pi-pi.localPath` alias
- Per-session root resolution; project-local memory roots supported
- Environment variables: `PI_MEMORY_ROOT`, `PI_MEMORY_CONSOLIDATION_MODEL`, `PI_VAULT_PATH`

**Vault integration**
- `vault_ref` field on memory records
- `promote_to_vault_candidate` patch op
- `vault_ref` auto-suggestions during curation when `PI_VAULT_PATH` is set
- Vault-promotion report generation under `reports/`
- `memory-governance` companion skill

**qmd integration**
- Three registered qmd contexts: `rendered/`, `daily/`, `sessions/summaries/`
- Session markdown summaries exported after each sync for semantic indexing

**Tools and commands**
- Tools: `memory_write`, `memory_read`, `memory_search`, `scratchpad`, `session_search`, `session_list`, `session_read`, `session_decisions`
- Commands: `/memory-doctor`, `/memory-inbox`, `/memory-patches`, `/apply-memory-patch`, `/curate-memory`, `/maintain-memory`, `/render-memory`, `/consolidate-memory`, `/session-sync`, `/session-reindex`, `/setup-session-search`

**Other**
- Interactive patch review TUI (`PatchReviewPanel`) with keyboard navigation and inline editing
- Legacy `MEMORY.md` migration importer
- GitHub Actions CI (tests + typecheck)
- GitHub Actions publish workflow (npmjs.com + GitHub Packages on `v*` tag)
- 104 passing tests
