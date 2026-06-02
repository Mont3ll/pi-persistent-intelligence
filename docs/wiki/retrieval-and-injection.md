# Retrieval and Injection

PI selects relevant memory records for each agent turn using a processor pipeline, then assembles an injection block that is delivered as a per-turn custom message.

---

## Injection as a custom message

Memory is injected as a per-turn custom message, not by mutating the system prompt. This matters for performance: the system prompt stays stable across turns, preserving the provider's KV-cache prefix. The dynamic memory block changes per-turn without invalidating the cached prefix.

If the system prompt mutated with every turn to include updated memory, every turn would be treated as uncached input, costing significantly more in token pricing.

---

## The processor pipeline

Before injection, every agent turn runs the active records through a four-stage processor pipeline. Each processor emits a trace explaining which records were excluded and why.

### 1. StatusFilterProcessor

Excludes records that are not `status: "active"`. Deprecated, superseded, contested, and deleted records are filtered here.

### 2. ProfileScopeProcessor

Excludes records whose `profile_id` does not match the current session's resolved profile. Cross-profile injection is hard-blocked.

Records without a `profile_id` (legacy records written before profile identity was added) pass through as compatible with any profile.

### 3. BasicScopeProcessor

Excludes project-scoped records (`scope.type: "project"`) when the record's project does not match the current working context.

Global and domain-scoped records pass through regardless of project.

### 4. NegativeScopeProcessor

Excludes records when the current context matches the record's negative scope fields:

- `does_not_apply_when`: if any phrase matches the current prompt or working directory context, the record is excluded
- `known_exceptions`: if any exception phrase matches, the record is excluded

Matching is deterministic and phrase-based; token prefix overlap is used for morphological variants (e.g. "publish" matches "publishing").

---

## Processor traces

Each processor run emits a trace with:
- `processor`: the processor name
- `input_count`: number of records entering the processor
- `output_count`: number of records passing through
- `excluded_ids`: IDs of excluded records
- `exclusion_reasons`: reason per excluded ID (e.g. `"status:deprecated"`, `"profile_mismatch:project:other"`, `"does_not_apply_when:publishing"`)

These traces are available in the `RetrievalContext` returned by `buildRetrievalContext()`.

---

## Record selection

After the pipeline, records are ranked by relevance to the current prompt using hybrid search:

- FTS (SQLite FTS5, BM25 ranking) over statement and tags: weight 0.45
- qmd semantic search (when configured): weight 0.55
- Combined via Reciprocal Rank Fusion

If qmd is not available, FTS-only ranking is used. If FTS is not available, term-matching fallback is used.

---

## The injection block

The assembled context block contains sections in priority order, subject to a 14KB total budget:

```markdown
# Persistent Intelligence Context

## Hard Rules
⚠️ AVOID: [conf 0.92] ...
✓ PREFER: [conf 0.90] ...
📌 RULE: [conf 0.88] ...

## Selected Memory
- mem_abc [L2, conf 0.94] ...
- mem_def [L2, conf 0.91 ⚠️ 45d] ...

## Scratchpad
- [ ] ...

## Contested Memory
<!-- Warning: these records have open conflicts. Review before relying on them. -->
⚠️ CONTESTED: [mem_xyz, conf 0.88] ...

## Daily Log (2026-05-20)
Sessions today: 3
...

## Today's Sessions
- [project] last message summary...
```

### Priority order

1. Hard Rules: high-confidence, active, correction-type records (threshold >= 0.85)
2. Selected Memory: top-ranked records from the processor pipeline
3. Scratchpad: open (incomplete) items
4. Contested Memory: context-relevant contested records (warning only, capped at 2)
5. Daily Log: today's session context digest

If any section would cause the block to exceed the budget, later sections are truncated.

---

## Hard rules

Records qualify as hard rules when:
- `status: "active"` (contested records are excluded)
- `confidence >= 0.85`
- `layer: "L2"`
- `ruleType` is in `[avoid_pattern, prefer_pattern, convention, correction]`

Up to 8 hard rules are injected per turn, sorted by confidence descending.

Hard rule prefixes:
- `avoid_pattern`: `⚠️ AVOID:`
- `prefer_pattern`: `✓ PREFER:`
- `convention`: `📌 CONVENTION:`
- `correction`: `📌 RULE:`

---

## Contested memory warning injection

When contested records are context-relevant to the current prompt, they appear in a separate "Contested Memory" section:

- Never under Hard Rules
- Capped at 2 records
- Requires token overlap with current prompt above a threshold
- Includes explicit warning: "Review before relying on them"

Contested records are ones where two or more pieces of evidence point in different directions, or where an explicit `contest` patch op has been applied.

---

## Staleness warnings

Records are injected with staleness indicators based on time since last update:

- 30+ days: `⚠️ 30d` (visible in Selected Memory)
- 90+ days: `🔴 90d` (visible in Selected Memory)

These do not block injection; they signal that the agent should verify the belief before acting on it.

---

## Injection filter

Context injection is skipped entirely for trivial prompts:

- Very short inputs (fewer than 4 characters)
- Slash commands (`/curate-memory`, etc.)
- Trivial acknowledgements: "ok", "yes", "thanks", "sounds good", "got it", "done", and similar

This prevents wasting tokens on turns where memory context adds no value.
