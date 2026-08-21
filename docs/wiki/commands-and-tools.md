# Commands and Tools

## Commands

Commands are invoked in the pi command bar with a `/` prefix.

---

### `/memory-doctor`

Displays a diagnostic summary of your memory setup.

Shows: memory root path, session index size, FTS status, governance mode, consolidation model, vault configuration, inbox candidate count, last injection performance when available, and notable medium/high runtime events from the last 24 hours.

```
/memory-doctor
```

---

### `/memory-store-integrity [--apply --fingerprint <sha256>] [--json]`

Previews canonical duplicate-ID and self-supersession repair without writing. Review the fingerprint in the preview before applying. Apply creates a mandatory backup and JSON audit report and refuses stale fingerprints.

```bash
/memory-store-integrity --json
/memory-store-integrity --apply --fingerprint <fingerprint-from-preview> --json
```

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

The report includes memory kind, retrieval score, available score provenance, context budget diagnostics, omission reasons, evidence status, trust class, scope mismatch, negative-scope match, tombstone state, contested state, staleness, and dependency invalidation.

---

### `/memory-export --format pi-governance [--redacted] [--output bundle.json]`

Exports a PI memory contract bundle compatible with `pi-governance-rs`.

```
/memory-export --format pi-governance --output /tmp/pi-demo-store/bundle.json
/memory-export --format pi-governance --redacted --output /tmp/pi-demo-store/redacted-bundle.json
```

Redacted export is best-effort and should be user-reviewed before sharing.

---

### `/memory-import --format pi-governance <bundle.json> [--apply] [--backup] [--redacted-aware]`

Dry-runs or merge-imports a PI memory contract bundle. Without `--apply`, import reports planned changes only.

```
/memory-import --format pi-governance /tmp/pi-demo-store/bundle.json
/memory-import --format pi-governance /tmp/pi-demo-store/bundle.json --apply --backup --redacted-aware
```

Imports skip duplicate record IDs, route proposed patches to the inbox, and keep L3/session context out of authoritative L1/L2 memory.

---

### `/memory-reconcile <peer-bundle.json> [--project <name>] [--profile <id>] [--json]`

Compares the local snapshot with an independent peer bundle across records, patches, evidence, inquiries, sessions, reinforcement, generic events, and tombstones.

```
/memory-reconcile /tmp/peer-bundle.json --json
```

The command is report-only: it has no apply mode, does not mutate either peer, and does not silently select an authority.

---

### `/memory-governance doctor`

Checks optional `pi-governance-rs` bridge configuration.

```
/memory-governance doctor
```

If the bridge is disabled, the command reports that standalone mode is active and valid. This package does not run an MCP server.

---

### `/memory-worth <observation>`

Scores whether an observation should become durable memory.

```
/memory-worth "Going forward, always run bun test before commit"
```

Decisions are `reject`, `daily_only`, `candidate`, and `inquiry`.

---

### `/memory-background enqueue <kind>|run|list`

Queues and runs inspectable local background analysis jobs. Supported report-producing kinds include `diagnostics`, `provenance_liveness`, `reverification`, `memory_graph`, `memory_timeline`, `procedure_candidates`, `memory_worth_review`, `memory_health_audit`, `memory_relationship_quality`, `memory_recall_effectiveness`, `memory_store_quality`, `meta_consolidation`, and `vault_promotion_candidates`.

```
/memory-background enqueue diagnostics
/memory-background run
/memory-background list
```

Background jobs do not directly mutate durable memory. Health, quality, relationship, recall, store, meta-consolidation, and vault-promotion background jobs are review/report-only; they do not mutate L1, L2, or vault files.

---

### `/memory-evidence migrate-legacy [--apply --fingerprint <sha256>] [--json]`

Previews deterministic provenance backfill for resolvable legacy evidence references. Apply requires the reviewed preview fingerprint, backs up evidence and affected canonical records, and writes an audit report. Missing or secret-bearing sources are never fabricated into evidence.

---

### `/memory-inquiries ...`

Lists inquiries by lifecycle status and explicitly answers, withdraws, or marks open inquiries stale. `stale-scan` is preview-first and requires its reviewed fingerprint for apply.

---

### `/memory-reinforce <memory-id> --note "..."`

Records explicit, deduplicated positive reinforcement for an active memory without changing the memory record. The `/memory-learnings` browser provides `r reinforce` on the highlighted record when a custom note is unnecessary.

Automatic implicit success is weaker: PI requires an explicitly recorded successful test, typecheck, lint, build, or validation outcome and attributes it to one uniquely relevant active selected memory. Ambiguous operations record no event, and silence is never treated as success.

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

### `/memory-evidence link <evidence-id> --statement "..."`

Links an existing evidence record to a new reviewable inbox candidate. This is a convenience workflow for turning deterministic evidence into a governed candidate without editing JSON.

```
/memory-evidence link ev_123 --statement "Always run bun test before commit" --kind instruction --tags testing,workflow --confidence 0.75
```

The linked candidate preserves the evidence ID, runs memory-worth scoring, clamps confidence through trust/evidence rules, and remains review-required. It does not directly mutate durable memory.

---

### `/memory-skill draft <procedure-candidate-id>`

Creates a review-only skill draft artifact from a procedure candidate. It suggests a skill path and content but never writes `SKILL.md` automatically.

```
/memory-skill draft proc_20260615000000
```

---

### `/memory-failures analyze [--save]`

Analyzes failed background jobs and rejected candidates into review-only inquiries or candidates. It uses memory-worth scoring and does not mutate durable memory.

```
/memory-failures analyze
/memory-failures analyze --save
```

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

### `/memory-capture-quality`

Shows aggregate preference capture outcomes, rejection reasons, proposed scope distribution, recurrence, and bounded runtime storage. The command is report-only.

```bash
/memory-capture-quality
/memory-capture-quality --json
```

---

### `/memory-capture-audit`

Reviews historical session summaries and canonical state for likely missed preferences, task-wrapper contamination, and likely scope errors. It does not create candidates or patches.

```bash
/memory-capture-audit --since 2026-05-01
/memory-capture-audit --since 2026-05-01 --json
```

---

### `/memory-capture-backfill`

Builds a deterministic candidate-only recovery preview. Apply requires the exact reviewed fingerprint, rejects source drift, validates a backup, and appends candidates for governance review. It does not activate memory or apply cleanup proposals.

```bash
/memory-capture-backfill --since 2026-05-01
/memory-capture-backfill --since 2026-05-01 --output capture-preview.json
/memory-capture-backfill --since 2026-05-01 --apply --fingerprint <reviewed-sha256>
```

---

### `/memory-store-quality`

Shows aggregate store health across memory quality, relationship quality, recall effectiveness, governance, inbox, and runtime signals. Headline memory and relationship scores measure the active operational population. The report separately exposes total, review, and historical inventory; retained history remains inspectable but does not depress current-health scores or create active recommendations. This is report-only.

```bash
/memory-store-quality
/memory-store-quality --json
```

---

### `/memory-recall-effectiveness`

Reviews recall telemetry: selected memories, excluded memories, never-recalled memories, and memories that were corrected after recall. This is operational analytics and does not mutate durable memory.

```bash
/memory-recall-effectiveness
/memory-recall-effectiveness --plain
```

---

### `/memory-relationship-quality`

Analyzes memory graph relationship health, including orphan/dead-end memories, weak evidence links, hub concentration, and useful relationship density. Active relationships determine headline scores and recommendations. Historical lifecycle edges and auxiliary graph context remain visible in separately counted populations. This is report-only.

```bash
/memory-relationship-quality
```

---

### `/memory-simulate-patch <patch-id>`

Previews how applying a patch would affect active memory quality, active relationship quality, store quality, and active/review/historical inventory. It never calls patch application and reports `mutation_performed: false`.

```bash
/memory-simulate-patch patch_123 --plain
/memory-simulate-patch patch_123 --json
```

---

### `/consolidate-memory`

Manually triggers LLM session extraction from buffered messages. Results go to the inbox.

```
/consolidate-memory
```

Requires at least two buffered user messages in the current session. By default, consolidation uses the current Pi session model; if no model has been observed it lets the Pi CLI use its configured default. Set `PI_MEMORY_CONSOLIDATION_MODEL` to force a preferred consolidation model.

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
