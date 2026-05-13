# pi-persistent-intelligence

Governed long-term memory, built-in session search, and Obsidian vault integration for the [pi](https://github.com/badlogic/pi-mono) coding agent.

> **Canonical memory is JSONL. Markdown is a rendered projection.**

```bash
pi install npm:pi-persistent-intelligence
/reload
```

---

## What it does

`pi-persistent-intelligence` gives pi a persistent, auditable operational memory that compounds across sessions:

- **Typed memory records** with evidence, confidence, stability, review cadence, change conditions, and supersession — L1 identity and L2 playbook layers
- **Automatic correction capture** — detects "don't use X", "prefer Y over Z", "always run typecheck" in user messages and captures them as inbox candidates without requiring explicit tool calls
- **Tiered curation** — high-confidence patterns auto-applied at session end; lower-confidence candidates surface in an inbox review panel at next session start
- **Built-in session search** — BM25 keyword over a local JSONL index, semantic via qmd when configured; `session_decisions` tool surfaces `#decision` markers across all past sessions
- **Hybrid memory retrieval** — built-in SQLite FTS5 (no external deps) fused with qmd semantic via RRF when available; falls back gracefully
- **Hard rules injection** — high-confidence correction memories injected with `⚠️ AVOID` / `✓ PREFER` / `📌 RULE` prefixes above general memory
- **Injection filter** — skips trivial prompts ("ok", "thanks", slash commands) to avoid wasting context budget
- **KV-cache-friendly** — memory injected as a per-turn custom message, not system prompt mutation; preserves provider prefix cache (10× token cost savings)
- **Vault integration** — `vault_ref` field, vault-promotion reports, and `memory-governance` skill for an Obsidian LLM Wiki companion

---

## Installation

```bash
pi install npm:pi-persistent-intelligence
/reload
```

### Project-local storage

To keep a project's memory isolated from the global store:

```json
// {project}/.pi/settings.json
{
  "pi-persistent-intelligence": {
    "localPath": ".pi/pi-memory"
  }
}
```

---

## Quick start

**Tag decisions in daily context:**
```bash
memory_write target=daily content="#decision switched to canonical JSONL as the source of truth"
```

**Propose a durable memory** (goes to inbox for review):
```bash
memory_write target=long_term \
  content="Always run bun test && bun run typecheck before pushing." \
  tags='["workflow","testing"]' \
  confidence=0.88
```

**Automatic capture**: say "don't use echo >> for vault notes, use sed" — detected automatically as an `avoid_pattern` candidate.

When ≥ 3 inbox candidates accumulate, an **inbox review panel** appears before your first agent turn — the same component as `/curate-memory`. Select/deselect ops with `Space`, apply with `Enter`, dismiss with `q`.

**Search past sessions:**
```bash
session_search "how did we debug the Lambda timeout"
session_decisions --days=30
```

**Browse memory records:**
```bash
/memory-learnings
```

**Diagnose setup:**
```bash
/memory-doctor
```

---

## Memory layers

| Layer | Store | Governance |
|---|---|---|
| **L1 Identity** | `memory/L1.identity.jsonl` | ≥ 3 evidence refs, confidence ≥ 0.85; never auto-applied |
| **L2 Playbooks** | `memory/L2.playbooks.jsonl` | ≥ 2 evidence refs, confidence ≥ 0.75; patch-only mutation |
| **L3 Session** | `daily/YYYY-MM-DD.md` | Freely writable; structured digest injected as context |

L1 and L2 records include: `id`, `layer`, `scope`, `tags`, `statement`, `evidence`, `confidence`, `stability`, `review.cadence_days`, `review.next_review`, `review.change_condition`, `status`, `supersedes`, `superseded_by`, `vault_ref`, and optionally `ruleType`.

### Rule types

The `ruleType` field classifies a memory record for better retrieval and hard-rule injection:

| Type | Meaning | Example |
|---|---|---|
| `avoid_pattern` | Something to avoid | "Don't use echo >> for file writes" |
| `prefer_pattern` | Preferred alternative | "Prefer bun over npm in this project" |
| `convention` | Project-specific convention | "This project uses event-sourcing for orders" |
| `architecture` | Architectural decision | "Auth service owns all JWT validation" |
| `workflow` | Process / how-to-work | "Always run typecheck before pushing" |
| `preference` | Tool or style preference | "Use conventional commits" |
| `testing` | Testing conventions | "Integration tests should not be mocked" |
| `correction` | General user correction | "That's not the right pattern here" |
| `tool` | Tool-specific pattern | "Use sed for vault note insertion, not echo" |

---

## Tools

| Tool | Description |
|---|---|
| `memory_write` | `target=daily` appends to log; `target=long_term` creates inbox candidate |
| `memory_read` | Read rendered long-term memory, daily log, scratchpad, or inbox |
| `memory_search` | Search PI memory. `mode=keyword` (default, built-in FTS, instant), `mode=semantic` (qmd), `mode=deep` (qmd hybrid) |
| `scratchpad` | Manage active task checklist |
| `session_search` | Search past pi sessions by content, project, or date |
| `session_list` | List sessions filtered by project or date range |
| `session_read` | Read full conversation from a past session by ID or path |
| `session_decisions` | List `#decision` markers from recent sessions |

---

## Commands

| Command | Description |
|---|---|
| `/memory-doctor` | Show memory root, session count, FTS status, auto-curation mode, vault path, inbox count |
| `/memory-inbox` | Show pending inbox candidates |
| `/memory-patches` | List patch files |
| `/apply-memory-patch <id>` | Apply selected ops from a patch |
| `/memory-learnings` | Interactive TUI table: browse, expand, or deprecate L2 memory records |
| `/curate-memory [--mode=propose\|auto]` | Interactive patch review panel for pending candidates; vault_ref hints when `PI_VAULT_PATH` is set |
| `/maintain-memory [--mode=propose\|auto]` | Generate confidence-decay patches for overdue records |
| `/render-memory` | Regenerate rendered markdown projection from canonical JSONL |
| `/consolidate-memory` | Manually trigger LLM extraction from current session |
| `/session-sync` | Sync session index; export markdown summaries for semantic search |
| `/session-reindex` | Force full re-parse of all session files |

---

## Configuration

Config file: `~/.pi/agent/pi-memory/config.json`

```json
{
  "curator": {
    "minConfidence": 0.75,
    "minEvidenceCount": 2,
    "autoCurate": "high-only",
    "autoCurateHighThreshold": 0.85,
    "inboxPromptThreshold": 3
  },
  "maintainer": {
    "semiStableDecay": 0.15,
    "stableDecay": 0.05
  },
  "vault": {
    "enabled": false,
    "path": null
  }
}
```

**`autoCurate`** — automatic curation at session end:

| Value | Behaviour |
|---|---|
| `"high-only"` | Auto-apply ops with confidence ≥ `autoCurateHighThreshold` (default, recommended) |
| `"all-eligible"` | Auto-apply every `default_selected` non-high-risk op |
| `"off"` | No automatic curation; always use `/curate-memory` |

L1 writes and supersede ops are **never** auto-applied regardless of mode.

**`inboxPromptThreshold`**: minimum pending candidates before the inbox review panel appears at session start. Set `0` to always show, `999` to disable.

### Environment variables

| Variable | Description |
|---|---|
| `PI_MEMORY_ROOT` | Override the memory root (default: `~/.pi/agent/pi-memory/`) |
| `PI_MEMORY_CONSOLIDATION_MODEL` | Model for session-end LLM extraction (default: `claude-haiku-4-5-20251001`) |
| `PI_VAULT_PATH` | Obsidian vault path; enables `vault_ref` suggestions during curation |

---

## Session search

Built-in — no additional packages, no Node 24 requirement.

```bash
session_search "Lambda timeout debugging"
session_search "schema migration" --project=api --after=2026-04-01
session_search "how did we handle the auth edge case" --mode=semantic
session_decisions --days=30
```

**Modes:**
- `mode=keyword` (default) — BM25 over a local JSONL index; instant, no setup
- `mode=semantic` — qmd embeddings over exported session summaries; run `qmd embed` first

Sessions are indexed on startup and watched via `fs.watch` (2-second debounce), with a 5-minute background interval as fallback. Disabled automatically inside subagents.

**Tag decisions** to make them surfaceable:
```bash
memory_write target=daily content="#decision use canonical JSONL, not markdown, as the source of truth"
```

---

## Memory search

```bash
memory_search "memory governance" --mode=keyword   # built-in FTS, no deps
memory_search "how should patterns be promoted" --mode=semantic   # qmd
memory_search "vault promotion" --mode=deep        # qmd hybrid reranking
```

**Modes:**
- `keyword` — built-in SQLite FTS5 via `bun:sqlite`; always available, no setup
- `semantic` — qmd vector search over `rendered/` and `daily/`
- `deep` — qmd hybrid (BM25 + vector + LLM reranking)

Cross-collection with vault:
```bash
qmd query "offline RL and memory governance" -c vault -c pi-persistent-intelligence
```

---

## Patch lifecycle

```text
candidate → curator → patch file written → apply → JSONL mutation → render markdown → qmd update
```

Supported ops: `add`, `update`, `decay`, `deprecate`, `supersede`, `reject_candidate`, `promote_to_vault_candidate`.

Patches are written before any mutation — including in `auto` mode.

---

## Vault companion

Pairs with an Obsidian LLM Wiki vault. The vault handles research-grade citation-backed knowledge; PI memory handles operational agent preferences and workflow patterns. They connect through promotion reports rather than automatic mutation.

Set `PI_VAULT_PATH` to enable `vault_ref` auto-suggestions during curation.

Template: https://github.com/Mont3ll/llm-wiki-vault-template

---

## Project structure

```text
index.ts                           # pi extension entry point
src/
  types.ts                         # types: MemoryRecord, MemoryRuleType, CaptureCandidate, PatchOp
  paths.ts                         # path resolution and settings.json cascade
  config.ts                        # config loading and defaults
  jsonl.ts                         # JSONL read/write helpers
  store.ts                         # canonical L1/L2 store
  render.ts                        # markdown projection renderer
  scratchpad.ts                    # checklist logic
  daily.ts                         # daily log helpers
  inbox.ts                         # candidate store
  curator.ts                       # deterministic curator with ruleType propagation
  maintainer.ts                    # confidence decay patches
  patch.ts                         # patch read/write/apply
  retriever.ts                     # async context builder (injection filter, FTS/hybrid, hard rules)
  injection-filter.ts              # trivial prompt detection
  rules.ts                         # hard rule extraction and formatting
  corrections.ts                   # automatic correction signal detection
  consolidator.ts                  # session-end LLM extraction with Jaccard dedup
  session-search.ts                # session tools and context block
  qmd.ts                           # qmd command wrapper
  migration.ts                     # legacy MEMORY.md importer
  vaultPromotion.ts                # vault promotion reports
  llmAssist.ts                     # LLM-assistance config guard
  project.ts                       # project identity inference
  search/
    fts.ts                         # SQLite FTS5 index (bun:sqlite, no external deps)
    hybrid.ts                      # RRF hybrid search (FTS 0.45 + semantic 0.55)
  sessions/
    parser.ts                      # pi session JSONL parser
    bm25.ts                        # BM25 keyword ranking
    store.ts                       # session index with markdown export
    utils.ts                       # shared utilities
  tui/
    PatchReviewPanel.ts            # patch review component (used by /curate-memory)
    InboxReviewOverlay.ts          # session-start inbox summary panel
    MemoryListPanel.ts             # /memory-learnings browsing component
skills/
  memory-governance/               # companion skill
.github/
  workflows/
    ci.yml                         # CI: tests + typecheck on push/PR
    publish.yml                    # Release: publish to npmjs.com + GitHub Packages on v* tag
```

---

## Development

```bash
bun test          # 138 tests
bun run typecheck
```
