# pi-persistent-intelligence

Governed long-term memory, built-in session search, and optional Obsidian vault integration for the [pi](https://github.com/badlogic/pi-mono) coding agent.

> **Canonical memory is JSONL. Markdown is a rendered projection.**

```bash
pi install npm:pi-persistent-intelligence
/reload
```

---

## What it does

`pi-persistent-intelligence` gives the pi coding agent a persistent, auditable operational memory that builds up across sessions.

PI carries project-specific learning from one session to the next. When you correct the agent, express a preference, or describe a project convention, PI scores whether the observation is worth preserving, captures useful items as candidates, verifies them, and promotes them to long-term memory through a reviewable patch flow. Memory is then scoped and injected back into future sessions.

The public model is **Retain, Recall, Reflect**: retain useful candidates with evidence, recall scoped memory with policy and diagnostics, and reflect by producing reviewable maintenance, abstraction, and procedure artifacts. See [`docs/retain-recall-reflect.md`](docs/retain-recall-reflect.md) for the longer model. All durable memory changes are patch-governed. No record is silently mutated. L1 identity records are never auto-applied.

---

## Quick start

```bash
pi install npm:pi-persistent-intelligence
/reload
```

**Tag a decision in the session log:**

```bash
memory_write target=daily content="#decision use canonical JSONL as the source of truth"
```

**Propose a durable memory (goes to inbox for review):**

```bash
memory_write target=long_term \
  content="Always run bun test and bun run typecheck before pushing." \
  tags='["workflow","testing"]' \
  confidence=0.88
```

**Automatic capture** -- no tool call needed. Say `"don't use echo >> for vault notes, use sed instead"` and PI detects and captures it automatically.

When enough inbox candidates accumulate, an **inbox review panel** appears at the start of your next session. Select and apply ops with the keyboard, or dismiss to review manually.

---

## Try it

```bash
/memory-inbox              # see pending candidates
/curate-memory             # review and apply them interactively
memory_search "bun test"   # search current memory
session_search "Lambda timeout debug"   # search past sessions
/memory-doctor             # check setup and status
/memory-diagnostics        # run integrity checks
```

---

## Lifecycle

```text
Session message / context compaction
  |
  v
Automatic correction capture
Session-end extraction
  |
  v
Memory-worth scoring
  |
  v
Evidence record
  |
  v
Candidate (trust class + durability signal + memory kind)
  |
  v
Verification (source support, trust boundary, conflict check)
  |
  v
Inbox review / curation
  |
  v
Patch-governed memory mutation
  |
  v
Scoped context injection
  |
  v
Reinforcement event
  |
  v
Maintenance recommendation
  |
  v
Meta-consolidation report (review-only L1 proposals)
```

---

## Memory layers

| Layer | Store | Governance |
|---|---|---|
| **L1 Identity** | `memory/L1.identity.jsonl` | Never auto-applied; requires explicit ratification |
| **L2 Playbooks** | `memory/L2.playbooks.jsonl` | Patch-governed; confidence and evidence gated |
| **L3 Session** | `daily/YYYY-MM-DD.md` | Freely writable; digest injected as context |
| **Evidence** | `memory/evidence.jsonl` | Content-addressed; bounded excerpts; redactable |
| **Reinforcement** | `memory/reinforcement.jsonl` | Explicit/implicit outcome events |
| **Inquiries** | `memory/inquiries.jsonl` | Open questions surfaced when relevant |
| **Tombstones** | `memory/tombstones.jsonl` | Content-free deletion markers; prevent re-promotion |

### Memory kinds

The optional `memory_kind` field gives records and candidates a simple public taxonomy:

| Kind | Meaning |
|---|---|
| `fact` | Durable claim about user, project, or system state |
| `event` | Timestamped thing that happened, decision, milestone, or completed work |
| `instruction` | User/project/team preference, rule, procedure, or workflow convention |
| `task` | Short-lived or active follow-up that should expire or be deprioritized |

Legacy records without `memory_kind` remain valid. Reports infer a kind when the field is absent.

### Rule types

The `ruleType` field on a memory record affects retrieval priority and hard-rule injection formatting.

| Type | Meaning |
|---|---|
| `avoid_pattern` | "Don't use echo >> for file writes" |
| `prefer_pattern` | "Prefer bun over npm in this project" |
| `convention` | "This project uses event-sourcing for orders" |
| `architecture` | "Auth service owns all JWT validation" |
| `workflow` | "Always run typecheck before pushing" |
| `preference` | "Use conventional commits" |
| `testing` | "Integration tests should not be mocked" |
| `correction` | General user correction |
| `tool` | "Use sed for vault note insertion" |

---

## Commands

| Command | Description |
|---|---|
| `/memory-doctor` | Show memory root, session count, FTS status, governance mode, vault path, inbox count |
| `/memory-diagnostics [--save]` | Run integrity, secret, provenance, and re-verification checks; `--save` writes JSON report to `reports/diagnostics/` |
| `/memory-recall-xray <query>` | Explain why memories are included or excluded for a query; read-only and redacted |
| `/memory-worth <observation>` | Score whether an observation should be rejected, kept daily-only, captured as a candidate, or turned into an inquiry |
| `/memory-background enqueue <kind>` | Queue an inspectable local background analysis job (`diagnostics`, `provenance_liveness`, `reverification`, `memory_graph`, `memory_timeline`, `procedure_candidates`, `memory_worth_review`) |
| `/memory-background run` | Run queued background jobs and write report artifacts |
| `/memory-background list` | List queued/running/succeeded/failed background analysis jobs |
| `/memory-evidence add-codebase-analysis ...` | Add deterministic codebase-analysis evidence from tools such as `tsc`, ESLint, Playwright, Vitest, Fallow-like analysis, or custom scripts |
| `/memory-evidence link <evidence-id> --statement "..."` | Turn existing evidence into a reviewable inbox candidate without bypassing governance |
| `/memory-skill draft <procedure-candidate-id>` | Generate a review-only skill draft artifact from a procedure candidate; never writes `SKILL.md` automatically |
| `/memory-failures analyze [--save]` | Mine failed jobs/rejected candidates into review-only learning artifacts |
| `/memory-graph [--save]` | Export a read-only dependency graph of memory, evidence, inquiries, tombstones, candidates, and reinforcement |
| `/memory-timeline [--memory <id>] [--save]` | Show timeline events and effective validity for one memory or the whole store |
| `/procedure-candidates [--save]` | Generate review-only procedure candidates from repeated workflow memory |
| `/memory-inbox` | List pending inbox candidates awaiting curation |
| `/memory-learnings` | Interactive TUI: browse, expand, or deprecate L2 memory records |
| `/memory-patches` | List pending patch files |
| `/apply-memory-patch <id>` | Apply default-selected ops from a patch file (syncs FTS for delete patches) |
| `/curate-memory [--mode=propose\|auto]` | Interactive patch review for pending candidates; vault_ref hints when `PI_VAULT_PATH` is set |
| `/maintain-memory [--mode=propose\|auto] [--report]` | Confidence-decay patches for overdue records; `--report` shows reinforcement-based stability recommendations |
| `/render-memory` | Regenerate Markdown projection from canonical JSONL |
| `/consolidate-memory` | Manually trigger session-end LLM extraction |
| `/meta-consolidation [--handoff]` | Propose L1 patterns from stable L2 clusters (report only; never auto-applies); `--handoff` also generates a snapshot |
| `/memory-handoff` | Generate a handoff snapshot of current active memory state; use `--goal <goal>` for goal handoff context |
| `/session-sync` | Sync session index; export summaries for semantic search |
| `/session-reindex` | Force full re-parse of all session files |

### Debug / setup commands

| Command | Description |
|---|---|
| `/setup-session-search` | Show session index size and qmd semantic-search setup hint |

---

## Tools

| Tool | Description |
|---|---|
| `memory_write` | `target=daily` appends to log; `target=long_term` creates inbox candidate |
| `memory_read` | Read rendered long-term memory, daily log, scratchpad, or inbox |
| `memory_search` | Search PI memory. `mode=keyword` (built-in FTS, instant), `mode=semantic` (qmd), `mode=deep` (qmd hybrid) |
| `scratchpad` | Manage active task checklist (add, done, undo, list) |
| `session_search` | Search past pi sessions by content, project, or date |
| `session_list` | List sessions filtered by project or date range |
| `session_read` | Read full conversation from a past session by ID or path |
| `session_decisions` | List `#decision` markers from recent sessions |

---

## Governance modes

PI supports two governance modes, configured in `~/.pi/agent/pi-memory/config.json`:

```json
{
  "governance": {
    "mode": "compatibility"
  }
}
```

| Mode | Behavior |
|---|---|
| `"compatibility"` | **Default.** Legacy candidates without trust metadata remain auto-eligible. Compatible with all pre-0.8.0 records. |
| `"strict"` | Candidates must carry trust metadata, a `verified` status, and at least one evidence ID before being default-selected for auto-apply. Opt-in. |

**L1 records are never auto-applied in any mode.**

---

## Evidence, trust, and verification

Every candidate captures where it came from:

- **Trust class**: `direct_user_instruction`, `user_correction`, `agent_inference`, `repository_text`, and others.
- **Durability signal**: `temporary`, `task`, `project`, `long_term`, and others.
- **Promotion eligibility**: derived from trust class and durability. Low-trust or temporary candidates route to review.
- **Poisoning risk**: repository text and generated content are flagged and cannot auto-apply.
- **Verification**: checks source support, durability, trust boundary, conflict risk, redacted evidence, and tombstone re-creation.
- **Codebase analysis evidence**: deterministic tool output such as `tsc`, ESLint, Playwright, Vitest, Fallow-like analysis, or custom scripts. This evidence can support a candidate or report, but it does not become automatic truth and does not bypass review. Existing evidence can be linked into reviewable candidates with `/memory-evidence link <evidence-id> --statement "..."`; linked candidates remain patch-governed and review-required.

Supported codebase tools are `tsc`, `eslint`, `playwright`, `vitest`, `fallow`, and `custom`. Supported analysis kinds are `typecheck`, `lint`, `test`, `e2e`, `dependency`, `dead_code`, `complexity`, `security`, `duplication`, and `custom`.

Examples:

```bash
/memory-evidence add-codebase-analysis --tool tsc --command "bun run typecheck" --exit-code 0 --analysis-kind typecheck --summary "typecheck passed"
/memory-evidence add-codebase-analysis --tool eslint --command "bun eslint ." --exit-code 1 --analysis-kind lint --file src/index.ts
/memory-evidence add-codebase-analysis --tool playwright --command "bun playwright test" --exit-code 0 --analysis-kind e2e
/memory-evidence add-codebase-analysis --tool fallow --command "fallow analyze" --exit-code 0 --analysis-kind dead_code
```

---

## Memory-worth scoring

Memory-worth scoring reduces low-value durable capture without silently discarding important explicit corrections.

| Decision | Meaning |
|---|---|
| `reject` | Do not create durable memory for trivial, sensitive, or unsuitable observations. |
| `daily_only` | Keep a short-lived session/day trace, but do not create a long-term candidate. |
| `candidate` | Create a reviewable durable candidate with worth metadata. |
| `inquiry` | Ask for clarification when an observation may be important but is ambiguous. |

The scorer is used by manual long-term capture, session consolidation, and context compaction. Explicit corrections, durable workflow rules, and project conventions remain eligible for candidate review.

---

## Data created by PI

PI stores everything under `~/.pi/agent/pi-memory/` by default. The directory layout:

```text
memory/
  L1.identity.jsonl
  L2.playbooks.jsonl
  profiles.jsonl
  evidence.jsonl
  reinforcement.jsonl
  inquiries.jsonl
  tombstones.jsonl
  projects/

daily/
  YYYY-MM-DD.md

inbox/
  captured.jsonl

patches/
  patch_*.json

rendered/
  MEMORY.md
  projects/

reports/
  diagnostics/
  meta-consolidation/
  handoff/

sessions/
search/
```

JSONL files are the canonical source. Markdown files are rendered projections.

---

## Deletion and forgetting

Two deletion modes are supported when applying a delete patch:

**`audit_preserving`**: marks the record as deleted and removes it from injection and search. The statement is preserved in the JSONL audit trail.

**`privacy_purge`**: redacts the statement to `[deleted]`, purges linked evidence content, writes a content-free tombstone, and syncs FTS immediately. No recoverable content remains in the normal memory files.

Tombstoned records cannot be re-promoted through any candidate path.

---

## Diagnostics

```bash
/memory-diagnostics         # run checks and display results
/memory-diagnostics --save  # also write JSON report to reports/diagnostics/
```

Diagnostics checks:
- required JSONL stores exist
- orphan evidence records (referencing non-existent memories)
- tombstoned records still appearing with active status
- contested records that would appear in hard-rule candidates
- deleted records leaking into rendered Markdown
- legacy records missing `profile_id` or `normalized_key` (informational only)
- duplicate normalized keys within a profile
- active records referencing redacted or deleted evidence
- high-confidence secret-like content in memory or evidence stores, with values redacted in output
- provenance liveness issues such as missing source files and invalidated evidence
- dependency-based re-verification recommendations

Each finding is severity-tagged: `ok`, `info`, `warning`, or `error`. A clean store produces zero errors.

---

## Safety and explainability reports

PI includes read-only reports for inspecting why memories exist and whether their support is still alive.

```bash
/memory-graph --save
/memory-timeline --memory mem_example --save
/memory-handoff --goal "Finish the release safely"
```

- **Secret scanning** blocks high-confidence secrets before long-term candidate or evidence persistence where PI controls the write path. Reports redact detected secret values. This is a conservative scanner, not a complete DLP system.
- **Provenance liveness** flags missing source files, redacted evidence, deleted evidence, and weakened support. It does not delete memories or lower trust automatically.
- **Dependency graph export** shows relationships between memories, evidence, inquiries, tombstones, candidates, reinforcement events, and supersession. It is a read-only report, not a graph query engine.
- **Timeline reporting** computes effective validity from creation, update, supersession, and tombstones without mutating legacy records. It is a read-only report, not a temporal database.
- **Goal handoff** summarizes active memory, inquiries, pending candidates, diagnostics warnings, and validation steps as background reference only.
- **Recall X-ray** explains why memories were included or excluded for a query. It reports included memories, excluded memories, retrieval tier, score or selection reason, available FTS/semantic score provenance, hard-rule attribution, context budget diagnostics, evidence state, trust class, memory kind, scope and negative-scope filtering, contested state, stale state, tombstones, dependency invalidation, and redacted output.
- **Background analysis jobs** queue local, inspectable report-producing work for diagnostics, provenance liveness, re-verification, memory graph, memory timeline, procedure candidates, and memory-worth review. Jobs do not directly mutate durable memory.
- **Procedure candidates** identify repeated workflow memory as review-only procedure drafts. `/memory-skill draft` can create a review artifact from a procedure candidate, but PI never writes skill files automatically.
- **Failure analysis** summarizes failed jobs and rejected candidates into review-only inquiries or candidates; it does not mutate durable memory.
- **Compaction traceability** stores reversible metadata for context-compaction artifacts where source sessions, evidence IDs, and digests are available.

### Injection modes

The default retrieval mode is `scoped`, which preserves the current selected-memory injection behavior. For lower-token operation, configure:

```json
{
  "retrieval": {
    "injectionMode": "policy_only"
  }
}
```

Supported modes:

- `scoped`: default scoped retrieval and injection
- `policy_only`: injects compact policy and search guidance, not raw selected memory. Memory is still available through search tools.
- `wakeup`: injects compact counts, governance mode, and suggested tools

Diagnostics report the last injection mode and character count when runtime stats are available.


---

## Contested memory warning injection

When contested memory records are context-relevant, PI injects a separate warning-only section below regular memory:

```
## Contested Memory
<!-- Warning: these records have open conflicts. Review before relying on them. -->
CONTESTED: [mem_id] Statement text here.
```

Contested records are:
- never placed under `## Hard Rules`
- capped at 2 records per injection
- only included when their content overlaps the current prompt

---

## Memory search

```bash
memory_search "bun test" --mode=keyword    # built-in FTS, no setup required
memory_search "vault promotion" --mode=semantic    # qmd (run qmd embed first)
memory_search "vault promotion" --mode=deep        # qmd hybrid reranking
```

---

## Session search

Built-in session search, no additional packages required.

```bash
session_search "Lambda timeout debugging"
session_search "schema migration" --project=api --after=2026-04-01
session_search "how did we handle the auth edge case" --mode=semantic
session_decisions --days=30
```

**Modes:** `keyword` (default, BM25, instant), `semantic` (qmd embeddings; run `qmd embed` first).

**Tag decisions** to make them surfaceable:

```bash
memory_write target=daily content="#decision use canonical JSONL as the source of truth"
```

---

## Maintenance and evals

```bash
/maintain-memory --report    # view reinforcement-based stability recommendations
```

Maintenance recommendations:
- Explicit correction suggests review and decreased stability.
- Explicit reinforcement (two or more) suggests stability increase.
- Implicit success alone cannot promote to `stable`.
- Neutral exposure produces no positive change.

All stability changes require patch application. Nothing is mutated automatically.

For contributors and developers:

```bash
bun run eval    # run the deterministic eval suite, including recall x-ray, memory-worth, background-job, codebase-evidence, and docs-contract categories
```

---

## Meta-consolidation

```bash
/meta-consolidation             # generate report only
/meta-consolidation --handoff   # also generate a handoff snapshot
```

Meta-consolidation clusters stable active L2 records within a single profile, performs a counterexample search (contested records, tombstones, open inquiries, redacted evidence), and generates a report with proposed L1 candidates.

Candidates are **review-only**. No L1 records are written without explicit human approval. Cross-profile clustering is hard-blocked.

Reports are written to `reports/meta-consolidation/`.

---

## Handoff snapshots

```bash
/memory-handoff
```

A handoff snapshot summarizes the current active memory state: record counts, selected memory, open inquiries, contested records, pending candidates. It is written to `reports/handoff/`.

Handoff snapshots are background reference material. The canonical persistent memory (L1/L2 JSONL) remains the authoritative source.

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
  },
  "governance": {
    "mode": "compatibility"
  }
}
```

**`governance.mode`**

| Value | Behavior |
|---|---|
| `"compatibility"` | Default. Legacy candidates remain auto-eligible. |
| `"strict"` | Requires trust metadata and verified status before auto-apply. |

**`autoCurate`** -- automatic curation at session end:

| Value | Behavior |
|---|---|
| `"high-only"` | Auto-apply ops with confidence >= `autoCurateHighThreshold` (default, recommended) |
| `"all-eligible"` | Auto-apply every `default_selected` non-high-risk op |
| `"off"` | No automatic curation; always use `/curate-memory` manually |

**`inboxPromptThreshold`**: minimum pending candidates before the inbox review panel appears. Set `0` to always show, `999` to disable.

### Meta-consolidation config

Meta-consolidation is **off by default** and always manual. The `/meta-consolidation` command ignores the `enabled` flag and always runs on demand. The `metaConsolidation` config block lets you adjust limits:

```json
{
  "metaConsolidation": {
    "enabled": false,
    "cadence": "manual",
    "min_l2_records": 2,
    "min_reinforcement_score": 0,
    "max_candidates_per_run": 5,
    "max_input_records": 50,
    "require_counterexample_search": true
  }
}
```

All fields are optional -- omitting the block keeps the defaults above.

### Environment variables

| Variable | Description |
|---|---|
| `PI_MEMORY_ROOT` | Override the memory root directory (default: `~/.pi/agent/pi-memory/`) |
| `PI_MEMORY_CONSOLIDATION_MODEL` | Model for session-end LLM extraction (default: `claude-haiku-4-5-20251001`) |
| `PI_VAULT_PATH` | Obsidian vault path; enables `vault_ref` suggestions during curation |

### Project-local storage

To keep a project's memory isolated:

```json
// {project}/.pi/settings.json
{
  "pi-persistent-intelligence": {
    "localPath": ".pi/pi-memory"
  }
}
```

---

## Vault companion

PI pairs with an Obsidian LLM Wiki vault. The vault stores research-grade citation-backed knowledge. PI stores operational agent preferences and workflow patterns. They connect through promotion reports, not automatic mutation.

Set `PI_VAULT_PATH` to enable `vault_ref` suggestions during curation.

Template: https://github.com/Mont3ll/llm-wiki-vault-template

---

## Safety guarantees

| Invariant | Notes |
|---|---|
| L1 records never auto-applied | Enforced in curator and auto-curation logic |
| Low-trust sources cannot auto-apply | `repository_text`, `generated_content`, `third_party_documentation` are blocked |
| Strict mode blocks unclassified candidates | Opt-in; default compatibility mode preserved |
| Deleted records not injected | Filtered by status and tombstone check in retriever |
| Deleted records not searchable after FTS sync | FTS synced atomically with delete via `applyPatchAndSync()` |
| Tombstoned records cannot be re-promoted | `patch.ts` throws on tombstoned add; `verifier.ts` rejects |
| Privacy purge leaves no recoverable content | Statement and evidence content redacted in-place |
| Cross-profile injection blocked | `ProfileScopeProcessor` enforces isolation |
| Cross-profile meta-consolidation blocked | `clusterL2Records` enforces profile boundary |
| Contested records never in hard rules | `extractHardRules()` requires `status === "active"` |
| L1/L2 writes require patch-apply context | Public `addMemoryRecord()` throws without context |
| Context-compaction does not mutate durable memory | Creates evidence and candidates only |
| Background jobs do not directly mutate durable memory | Queue and report artifacts only |
| Codebase-analysis evidence does not bypass review | Treated as supporting evidence, not user preference truth |
| Procedure candidates do not write skills | Export boundary is review-gated; no automatic `SKILL.md` writes |
| Meta-consolidation does not mutate L1 | Report and review-only candidates only |

---

## Patch lifecycle

Every durable memory change goes through a patch file:

```text
candidate
  |
  v
verification
  |
  v
curator (evidence gates, trust gates, conflict matching)
  |
  v
patch file written (before mutation)
  |
  v
applyPatch() or applyPatchAndSync()
  |
  v
JSONL mutation
  |
  v
Markdown render
  |
  v
FTS / qmd update
```

Supported patch operations: `add`, `update`, `update_stability`, `flag_for_review`, `decay`, `deprecate`, `supersede`, `contest`, `uncontest`, `add_exception`, `delete`, `reject_candidate`, `promote_to_vault_candidate`.

`applyPatchAndSync(root, patch, options, ftsIndex)` is the preferred public helper for delete and privacy-purge flows. It applies the patch and syncs FTS atomically.

---

## Limitations

- **L1 is never auto-applied.** Review and explicit ratification are always required.
- **Session-end LLM extraction requires a model.** Configurable via `PI_MEMORY_CONSOLIDATION_MODEL`. Correction capture and `memory_write` work without it.
- **Semantic search requires qmd setup.** Run `qmd embed` after install. Keyword search works immediately.
- **Strict governance mode blocks legacy candidates.** Use `"compatibility"` mode when importing older patterns.
- **FTS sync is caller-controlled after low-level `applyPatch()`.** Use `applyPatchAndSync()` for delete flows where immediate FTS consistency is expected.
- **Evidence store grows unbounded.** `audit_preserving` deletion retains content for audit. `privacy_purge` removes it.

---

## Development

```bash
bun test               # 256 tests
bun run typecheck
bun run eval           # 14-category deterministic eval suite, 7 hard invariants
```
