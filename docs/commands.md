# Command Reference

This page lists the public commands and tools provided by `pi-persistent-intelligence`.

For first-time setup and the short workflow, start with the [README](../README.md).

## Core commands

| Command | Description |
|---|---|
| `/memory-inbox` | List pending inbox candidates awaiting curation. |
| `/curate-memory [--mode=propose\|auto]` | Review pending candidates and apply selected patch operations. |
| `/memory-doctor` | Show memory root, session count, FTS status, governance mode, vault path, and inbox count. |
| `/memory-diagnostics [--save]` | Run integrity, secret, provenance, and re-verification checks; `--save` writes a diagnostics report. |
| `/memory-recall-xray <query>` | Explain why memories are included or excluded for a query; read-only and redacted. |
| `/memory-export --format pi-governance [--redacted] [--output bundle.json]` | Export a pi-governance-compatible PI memory contract bundle. |
| `/memory-import --format pi-governance <bundle.json> [--apply] [--backup] [--redacted-aware]` | Preview or apply a pi-governance-compatible bundle import. By default this is a dry-run import. |
| `/memory-governance doctor` | Check optional pi-governance-rs bridge configuration; disabled standalone mode is valid. |

## Memory lifecycle commands

| Command | Description |
|---|---|
| `/memory-worth <observation>` | Score whether an observation should be rejected, kept daily-only, captured as a candidate, or turned into an inquiry. |
| `/memory-patches` | List pending patch files. |
| `/apply-memory-patch <id>` | Apply default-selected operations from a patch file. |
| `/maintain-memory [--mode=propose\|auto] [--report]` | Generate confidence-decay patches and reinforcement-based stability recommendations. |
| `/render-memory` | Regenerate Markdown projection from canonical JSONL. |
| `/consolidate-memory` | Manually trigger session-end LLM extraction. |
| `/meta-consolidation [--handoff]` | Propose L1 patterns from stable L2 clusters; review-only and never auto-applied. |
| `/memory-handoff [--goal <goal>]` | Generate a handoff snapshot of current active memory state. |

## Evidence, diagnostics, and review commands

| Command | Description |
|---|---|
| `/memory-background enqueue <kind>` | Queue an inspectable local background analysis job. Supported kinds include `diagnostics`, `provenance_liveness`, `reverification`, `memory_graph`, `memory_timeline`, `procedure_candidates`, `memory_worth_review`, `meta_consolidation`, and `vault_promotion_candidates`. |
| `/memory-background run` | Run queued background jobs and write report artifacts. |
| `/memory-background list` | List queued, running, succeeded, and failed background analysis jobs. |
| `/memory-evidence add-codebase-analysis ...` | Add deterministic codebase-analysis evidence from tools such as `tsc`, ESLint, Playwright, Vitest, Fallow-like analysis, or custom scripts. |
| `/memory-evidence link <evidence-id> --statement "..."` | Turn existing evidence into a reviewable inbox candidate without bypassing governance. |
| `/memory-skill draft <procedure-candidate-id>` | Generate a review-only skill draft artifact from a procedure candidate; never writes `SKILL.md` automatically. |
| `/memory-failures analyze [--save]` | Mine failed jobs or rejected candidates into review-only learning artifacts. |
| `/memory-graph [--save]` | Export a read-only dependency graph of memory, evidence, inquiries, tombstones, candidates, and reinforcement. |
| `/memory-timeline [--memory <id>] [--save]` | Show timeline events and effective validity for one memory or the whole store. |
| `/procedure-candidates [--save]` | Generate review-only procedure candidates from repeated workflow memory. |
| `/memory-learnings` | Interactive TUI for browsing, expanding, or deprecating L2 memory records. |

## Session search commands

| Command | Description |
|---|---|
| `/session-sync` | Sync session index and export summaries for semantic search. |
| `/session-reindex` | Force full re-parse of all session files. |
| `/setup-session-search` | Show session index size and qmd semantic-search setup hint. |

## Tools

| Tool | Description |
|---|---|
| `memory_write` | `target=daily` appends to the daily log; `target=long_term` creates an inbox candidate. |
| `memory_read` | Read rendered long-term memory, daily log, scratchpad, or inbox. |
| `memory_search` | Search PI memory. `mode=keyword` uses built-in FTS, `mode=semantic` uses qmd, and `mode=deep` uses qmd hybrid search. |
| `scratchpad` | Manage active task checklist: add, done, undo, clear done, or list. |
| `session_search` | Search past pi sessions by content, project, or date. |
| `session_list` | List sessions filtered by project or date range. |
| `session_read` | Read a full conversation from a past session by ID or path. |
| `session_decisions` | List `#decision` markers from recent sessions. |

## Examples

```bash
/memory-inbox
/curate-memory
/memory-diagnostics --save
/memory-recall-xray "release workflow"
/memory-export --format pi-governance --redacted --output bundle.json
/memory-import --format pi-governance bundle.json
/memory-import --format pi-governance bundle.json --apply --backup --redacted-aware
/memory-governance doctor
```

```bash
memory_write target=daily content="#decision use canonical JSONL as source of truth"
memory_write target=long_term content="Always run bun test before pushing." confidence=0.88
memory_search "bun test" --mode=keyword
session_search "auth edge case" --project=api
session_decisions --days=30
```
