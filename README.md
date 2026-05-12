# pi-persistent-intelligence

Governed long-term memory, built-in session search, and Obsidian vault integration for the [pi](https://github.com/badlogic/pi-mono) coding agent.

> **Canonical memory is JSONL. Markdown is a rendered projection.**

```bash
pi install npm:pi-persistent-intelligence
/reload
```

---

## What it does

- **L1/L2/L3 memory layers** — identity, playbooks, and session context kept separate with different governance rules
- **Patch-governed mutation** — every durable memory change writes a patch file before touching canonical JSONL; full audit trail
- **Automatic curation** — high-confidence patterns (≥ 0.85) are applied at session end; lower-confidence candidates surface in an inbox review overlay
- **Inbox review overlay** — permission-prompt-style TUI modal before the first agent turn; approve, review, or skip pending candidates without leaving the session
- **Built-in session search** — `session_search`, `session_list`, `session_read`, `session_decisions` with no external dependencies; BM25 keyword or qmd semantic
- **KV-cache-friendly injection** — memory injected as a per-turn custom message, not a system prompt mutation; preserves provider prefix cache
- **Staleness warnings** — injected records show ⚠️ (30 days+) or 🔴 (90 days+) age indicators
- **Vault integration** — `vault_ref` field, vault-promotion reports, and `memory-governance` skill for an Obsidian LLM Wiki companion

---

## Installation

```bash
pi install npm:pi-persistent-intelligence
/reload
```

### Project-local storage

To isolate a project's memory from the global store, add to `{project}/.pi/settings.json`:

```json
{
  "pi-persistent-intelligence": {
    "localPath": ".pi/pi-memory"
  }
}
```

---

## Quick start

Write ephemeral session context:

```text
memory_write target=daily content="#decision switched to JSONL canonical store"
```

Propose durable memory — goes to inbox, not directly to canonical store:

```text
memory_write target=long_term content="Always run typecheck before committing." tags=["workflow"] confidence=0.82
```

When ≥ 3 candidates accumulate, an overlay appears before the first agent turn:

```
╭──────────────────────────────────────────────────────────────╮
│  📬 Memory Inbox  (3 candidates pending)                     │
├──────────────────────────────────────────────────────────────┤
│  ✓ conf 0.92  Always run typecheck before committing         │
│  ✓ conf 0.87  Use patch files before mutating memory         │
│  ~ conf 0.78  Consider Redis for session caching             │
│                                                              │
│  [A] Apply 2 auto-eligible  [R] Review  [S] Skip             │
╰──────────────────────────────────────────────────────────────╯
```

Manual curation for L1 ops and items below the auto-threshold:

```text
/curate-memory
/curate-memory --mode=auto
```

Search past sessions:

```text
session_search "how did we debug the Lambda timeout"
session_decisions --days=14
```

Diagnose setup:

```text
/memory-doctor
```

---

## Memory layers

| Layer | Store | Governance |
|---|---|---|
| **L1 Identity** | `memory/L1.identity.jsonl` | Confidence ≥ 0.85, ≥ 3 evidence refs; never auto-applied |
| **L2 Playbooks** | `memory/L2.playbooks.jsonl` | Confidence ≥ 0.75, ≥ 2 evidence refs; patch-only mutation |
| **L3 Session** | `daily/YYYY-MM-DD.md` | Freely writable; structured digest injected as context |

L1 and L2 records include: `id`, `layer`, `scope`, `tags`, `statement`, `evidence`, `confidence`, `stability`, `review.cadence_days`, `review.next_review`, `review.change_condition`, `status`, `supersedes`, `superseded_by`, `vault_ref`.

---

## Tools

| Tool | Description |
|---|---|
| `memory_write` | `target=daily` appends to log; `target=long_term` creates inbox candidate |
| `memory_read` | Read rendered long-term memory, daily log, scratchpad, or inbox |
| `memory_search` | qmd search over PI memory (keyword / semantic / deep) |
| `scratchpad` | Manage active task checklist |
| `session_search` | Search past pi sessions by content, project, or date |
| `session_list` | List sessions filtered by project or date range |
| `session_read` | Read full conversation from a past session by ID or path |
| `session_decisions` | List `#decision` markers from recent sessions |

---

## Commands

| Command | Description |
|---|---|
| `/memory-doctor` | Show memory root, session index count, auto-curation mode, vault path |
| `/memory-inbox` | Show pending inbox candidates |
| `/memory-patches` | List patch files |
| `/apply-memory-patch <id>` | Apply selected ops from a patch |
| `/curate-memory [--mode=propose\|auto]` | Promote inbox candidates to L2 patches |
| `/maintain-memory [--mode=propose\|auto]` | Generate decay patches for overdue records |
| `/render-memory` | Regenerate markdown projection from canonical JSONL |
| `/consolidate-memory` | Manually trigger LLM extraction from current session |
| `/session-sync` | Sync session index; export markdown summaries |
| `/session-reindex` | Force full re-parse of all session files |

---

## Configuration

Config file: `~/.pi/agent/pi-memory/config.json`. All fields are optional; defaults shown.

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

**`autoCurate`** controls automatic curation at session end:

| Value | Behaviour |
|---|---|
| `"high-only"` | Auto-apply ops with confidence ≥ `autoCurateHighThreshold` (default) |
| `"all-eligible"` | Auto-apply every `default_selected` non-high-risk op |
| `"off"` | No automatic curation; always use `/curate-memory` |

L1 writes and supersede ops are **never** auto-applied regardless of mode.

**`inboxPromptThreshold`**: minimum pending candidates before the inbox overlay appears. Set `0` for always-on, `999` to disable.

### Environment variables

| Variable | Description |
|---|---|
| `PI_MEMORY_ROOT` | Override the memory root (default: `~/.pi/agent/pi-memory/`) |
| `PI_MEMORY_CONSOLIDATION_MODEL` | Model for session-end LLM extraction (default: `claude-haiku-4-5-20251001`) |
| `PI_VAULT_PATH` | Path to an Obsidian vault; enables `vault_ref` auto-suggestions during curation |

---

## Session search

Session search is built in — no additional packages required, no Node 24 dependency.

Tools: `session_search`, `session_list`, `session_read`, `session_decisions`

```text
session_search "Lambda timeout debugging"
session_search "schema migration" --project=lms --after=2026-04-01
session_search "how did we handle auth" --mode=semantic
session_decisions --days=30
```

**Modes:**
- `mode=keyword` (default) — BM25 over a JSONL session index; instant, works everywhere
- `mode=semantic` — qmd embeddings over exported markdown summaries; run `qmd embed` first

Sessions are synced at startup and watched for changes via `fs.watch` (2-second debounce), with a 5-minute background interval as fallback.

**`#decision` tagging:** tag important decisions in daily notes to surface them in `session_decisions`:

```text
memory_write target=daily content="#decision use canonical JSONL not markdown as the source of truth"
```

---

## Vault integration

`pi-persistent-intelligence` does not mutate the vault directly.

When a memory pattern is stable and reusable, set `vault_ref` on the record and use `/curate-memory` to emit a vault-promotion candidate. The vault then applies its own governance (citation discipline, backlinks, index/log updates) before the idea becomes durable research knowledge.

Set `PI_VAULT_PATH` to enable `vault_ref` auto-suggestions during curation: the curator scans vault concept and entity pages for filenames matching candidate tags.

---

## Patch lifecycle

```text
candidate → curator → patch file written → apply → JSONL mutation → render markdown → qmd update
```

Supported patch ops: `add`, `update`, `decay`, `deprecate`, `reject_candidate`, `supersede`, `promote_to_vault_candidate`.

Patches are written before any mutation — including in `auto` mode.

---

## Curation modes

| Mode | Behaviour |
|---|---|
| `propose` | Generate patch; wait for explicit `/apply-memory-patch` |
| `supervised` | Per-operation interactive review |
| `auto` | Apply eligible `default_selected` non-high-risk ops immediately |

---

## qmd integration

The extension registers three qmd contexts:

```bash
qmd search "memory governance" -c pi-persistent-intelligence
qmd vsearch "how should durable patterns be promoted" -c pi-persistent-intelligence
qmd query "what do I know about vault promotion" -c pi-persistent-intelligence
```

Contexts: `rendered/` (long-term memory), `daily/` (session logs), `sessions/summaries/` (past session content).

Cross-collection search with an Obsidian vault:

```bash
qmd query "offline RL and memory governance" -c vault -c pi-persistent-intelligence
```

---

## Vault companion

Pairs with an Obsidian LLM Wiki vault that keeps research knowledge governed separately from operational memory. Template: https://github.com/Mont3ll/llm-wiki-vault-template

---

## Project structure

```text
index.ts                         # pi extension entry point
src/
  types.ts                       # memory, candidate, patch types
  paths.ts                       # root resolution and settings.json cascade
  config.ts                      # config loading and defaults
  jsonl.ts                       # JSONL read/write helpers
  store.ts                       # canonical L1/L2 store
  render.ts                      # markdown projection renderer
  scratchpad.ts                  # checklist logic
  daily.ts                       # daily log helpers
  inbox.ts                       # capture candidate store
  curator.ts                     # deterministic curator with vault_ref hints
  maintainer.ts                  # confidence decay patches
  patch.ts                       # patch read/write/apply
  retriever.ts                   # async context builder
  consolidator.ts                # session-end LLM extraction with Jaccard dedup
  session-search.ts              # session tools and context block
  qmd.ts                         # qmd command wrapper
  migration.ts                   # legacy MEMORY.md importer
  vaultPromotion.ts              # vault promotion reports
  llmAssist.ts                   # LLM-assistance config guard
  sessions/
    parser.ts                    # pi session JSONL parser
    bm25.ts                      # BM25 keyword ranking
    store.ts                     # session index with markdown export
    utils.ts                     # shared utilities
  tui/
    PatchReviewPanel.ts          # patch review TUI component
    InboxReviewOverlay.ts        # inbox review overlay component
skills/
  memory-governance/             # companion skill
.github/
  workflows/
    ci.yml                       # CI: tests + typecheck
    publish.yml                  # Release: publish to npm and GitHub Packages
```

---

## Development

```bash
bun test
bun run typecheck
```

Smoke-test:

```bash
PI_MEMORY_ROOT=$(mktemp -d) bun -e 'const mod = await import("./index.ts"); if (typeof mod.default !== "function") throw new Error(); console.log("ok")'
```
