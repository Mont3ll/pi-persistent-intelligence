# Commands and Tools

## Commands

Commands are invoked in the pi command bar with a `/` prefix.

---

### `/memory-doctor`

Displays a diagnostic summary of your memory setup.

Shows: memory root path, session index size, FTS status, governance mode, consolidation model, vault configuration, inbox candidate count.

```
/memory-doctor
```

---

### `/memory-diagnostics [--save]`

Runs integrity checks on your memory store and reports findings with severity levels: `ok`, `info`, `warning`, `error`.

```
/memory-diagnostics          # display results
/memory-diagnostics --save   # display results and save JSON report
```

Checks include orphan evidence, tombstoned-in-active records, contested records in hard-rule path, deleted records in rendered Markdown, duplicate normalized keys, active records referencing redacted evidence, secret-like content, provenance liveness warnings, and re-verification recommendations.

See [Diagnostics](diagnostics.md) for the full check list.

---

### `/memory-recall-xray <query>`

Explains why memories would be included or excluded for a query. The command is read-only and redacts secret-like content.

```
/memory-recall-xray "bun test"
```

The report includes memory kind, retrieval score, evidence status, trust class, scope mismatch, negative-scope match, tombstone state, contested state, staleness, and dependency invalidation.

---

### `/memory-worth <observation>`

Scores whether an observation should become durable memory.

```
/memory-worth "Going forward, always run bun test before commit"
```

Decisions are `reject`, `daily_only`, `candidate`, and `inquiry`.

---

### `/memory-background enqueue <kind>|run|list`

Queues and runs inspectable local background analysis jobs. Supported report-producing kinds include `diagnostics`, `provenance_liveness`, `reverification`, `memory_graph`, `memory_timeline`, `procedure_candidates`, and `memory_worth_review`.

```
/memory-background enqueue diagnostics
/memory-background run
/memory-background list
```

Background jobs do not directly mutate durable memory.

---

### `/memory-evidence add-codebase-analysis ...`

Adds deterministic codebase-analysis evidence. Evidence is support, not automatic durable truth.

```
/memory-evidence add-codebase-analysis --tool tsc --command "bun run typecheck" --exit-code 0 --analysis-kind typecheck --summary "typecheck passed"
/memory-evidence add-codebase-analysis --tool eslint --command "bun eslint ." --exit-code 1 --analysis-kind lint --file src/index.ts
/memory-evidence add-codebase-analysis --tool playwright --command "bun playwright test" --exit-code 0 --analysis-kind e2e
/memory-evidence add-codebase-analysis --tool fallow --command "fallow analyze" --exit-code 0 --analysis-kind dead_code
```

Supported tools: `tsc`, `eslint`, `playwright`, `vitest`, `fallow`, `custom`.

Supported analysis kinds: `typecheck`, `lint`, `test`, `e2e`, `dependency`, `dead_code`, `complexity`, `security`, `duplication`, `custom`.

---

### `/memory-graph [--save]`

Exports a read-only dependency graph across memory records, evidence, inquiries, tombstones, candidates, and reinforcement events.

```
/memory-graph
/memory-graph --save
```

Saved reports are written to `reports/memory-graph/`.

---

### `/memory-timeline [--memory <id>] [--save]`

Shows memory timeline events and effective validity.

```
/memory-timeline
/memory-timeline --memory mem_example
/memory-timeline --memory mem_example --save
```

Saved reports are written to `reports/timeline/`.

---

### `/procedure-candidates [--save]`

Generates review-only procedure candidates from repeated workflow memory. Does not write skill files or mutate memory.

```
/procedure-candidates
/procedure-candidates --save
```

Saved reports are written to `reports/procedure-candidates/`.

---

### `/memory-inbox`

Lists pending inbox candidates awaiting curation.

```
/memory-inbox
```

---

### `/memory-learnings`

Opens an interactive TUI panel for browsing and managing L1 and L2 memory records.

Navigate with arrow keys. Press `e` to expand a record. Press `d` to deprecate. Press `q` to close.

```
/memory-learnings
```

---

### `/memory-patches`

Lists pending patch files.

```
/memory-patches
```

---

### `/apply-memory-patch <id>`

Applies default-selected ops from a specific patch file. For delete patches, FTS is synced immediately.

```
/apply-memory-patch patch_20260520_001
```

---

### `/curate-memory [--mode=propose|auto]`

Reviews and applies pending inbox candidates through the interactive patch review panel.

```
/curate-memory                # interactive review (default)
/curate-memory --mode=auto    # apply all eligible ops immediately
```

In the review panel: space toggles selection, enter applies selected ops, `q` cancels.

---

### `/maintain-memory [--mode=propose|auto] [--report]`

Generates confidence-decay patches for overdue records and reinforcement-based stability recommendations.

```
/maintain-memory               # interactive review
/maintain-memory --mode=auto   # apply decay ops automatically
/maintain-memory --report      # show stability recommendations without applying
```

---

### `/render-memory`

Regenerates the rendered Markdown projection from canonical JSONL.

```
/render-memory
```

---

### `/consolidate-memory`

Manually triggers LLM session extraction from buffered messages. Results go to the inbox.

```
/consolidate-memory
```

Requires at least two buffered user messages in the current session.

---

### `/meta-consolidation [--handoff]`

Clusters stable L2 records and generates review-only L1 candidate proposals. Reports are written to `reports/meta-consolidation/`. No memory is mutated.

```
/meta-consolidation              # generate report only
/meta-consolidation --handoff    # also generate a handoff snapshot
```

See [Meta-Consolidation](meta-consolidation.md).

---

### `/memory-handoff`

Generates a handoff snapshot of current active memory state. Written to `reports/handoff/`. Does not mutate canonical memory. Use `--goal` to create a goal handoff summary as background reference.

```
/memory-handoff
/memory-handoff --goal "Finish the release safely"
```

See [Handoff Snapshots](handoff-snapshots.md).

---

### `/session-sync`

Manually syncs the session index. Exports markdown summaries for semantic search.

```
/session-sync
```

---

### `/session-reindex`

Forces a full re-parse of all session files. Use when the session index is out of sync.

```
/session-reindex
```

---

### `/setup-session-search` (debug/setup)

Shows session index size and qmd semantic-search setup hint.

```
/setup-session-search
```

---

## Tools

Tools are callable by the agent directly in conversation, without a `/` prefix.

---

### `memory_write`

Write to PI memory.

| Parameter | Value |
|---|---|
| `target` | `"daily"` or `"long_term"` |
| `content` | The text to write |
| `tags` | Optional array of tag strings |
| `confidence` | Optional number 0-1 (default: 0.7 for long_term) |

`daily` appends directly to the session log. `long_term` creates an inbox candidate.

```bash
memory_write target=daily content="#decision use event-sourcing for orders"
memory_write target=long_term content="Always run bun test before pushing." tags='["workflow","testing"]' confidence=0.88
```

---

### `memory_read`

Read from PI memory.

| Target | Returns |
|---|---|
| `long_term` | Rendered long-term memory (L1 + L2) |
| `daily` | Today's daily log |
| `scratchpad` | Active checklist items |
| `inbox` | Raw inbox candidates JSON |

```bash
memory_read target=long_term
memory_read target=daily
memory_read target=scratchpad
```

---

### `memory_search`

Search PI memory records.

| Mode | Description |
|---|---|
| `keyword` (default) | Built-in SQLite FTS5; instant, no setup required |
| `semantic` | qmd vector search (requires `qmd embed`) |
| `deep` | qmd hybrid BM25 + vector + reranking |

```bash
memory_search "bun test"
memory_search "caching strategy" --mode=semantic
memory_search "auth patterns" --mode=deep --limit=5
```

---

### `scratchpad`

Manage the active task checklist.

```bash
scratchpad action=add text="Review auth PR"
scratchpad action=done text="Review auth PR"
scratchpad action=list
scratchpad action=clear_done
```

---

### `session_search`

Search past pi sessions by content, project, or date.

```bash
session_search "Lambda timeout"
session_search "auth edge case" --project=api --after=2026-04-01
session_search "debugging approach" --mode=semantic
```

---

### `session_list`

List past sessions filtered by project or date range.

```bash
session_list
session_list --project=my-project
session_list --after=2026-05-01 --before=2026-05-15
```

---

### `session_read`

Read the full conversation from a past session.

```bash
session_read session=<session-id-or-path>
```

---

### `session_decisions`

List `#decision` markers from recent sessions. Tag decisions in daily logs with `#decision` to surface them here.

```bash
session_decisions --days=7
session_decisions --project=my-project --days=30
```
