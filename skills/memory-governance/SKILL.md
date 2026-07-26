---
name: memory-governance
description: Use when deciding whether information belongs in PI memory, the scratchpad, daily logs, or the Obsidian vault; use before proposing L1/L2 memory changes or vault promotion.
---

# Memory Governance

Persistent Intelligence separates operational context from durable beliefs.

## Routing rule

| Information | Destination |
|---|---|
| Active task or reminder | `scratchpad` |
| Session note, recent decision, in-progress context | `memory_write target=daily` with `#decision` tag |
| Durable workflow/playbook/preference | `memory_write target=long_term` → inbox → `/curate-memory` |
| Direct preference or correction | Captured deterministically as a governed inbox candidate |
| Research source, citation-backed domain claim | Obsidian vault under AGENTS.md protocol |
| Stable dev pattern observed in 2+ projects for 30+ days | `promote_to_vault_candidate` patch op |

## Deterministic preference and correction capture

You do not need to call `memory_write` for direct preferences or corrections. Natural instructions such as "Avoid promotional language in my public writing" and "This project always runs the release audit before publishing" are classified at the end of the turn and checkpointed immediately. Capture does not depend on session shutdown or LLM consolidation.

Direct capture is candidate-first. It never writes an active memory record by itself. A singleton direct-user candidate is visible for review, while generated or inferred singleton candidates keep the normal batch threshold. Equivalent preferences add recurrence evidence to one candidate rather than disappearing as duplicates.

Scope is independent of the launch directory:

- Personal writing, interaction, and cross-project workflow preferences are proposed as global L2 records and require review.
- Repository conventions target every materially modified repository.
- Read-only repositories and a vault used as a research source are not inferred as targets.
- Explicit project or vault restrictions override inferred activity.

## L1 vs L2

L1 identity memory is rare and high risk:
- requires strong repeated evidence
- must include a falsifiable change condition
- never auto-applies

L2 is the productive layer for personal preferences, repository conventions, corrections, and playbooks:
- direct user evidence can create an inbox candidate immediately
- recurrence strengthens provenance without silently activating the rule
- global preferences always require explicit review
- approved multi-project candidates materialize as one correlated record per project
- records include rule type, tags, evidence, stability, review cadence, and a change condition

## Rule types

Use the `ruleType` tag hint when calling `memory_write target=long_term` for better injection:

```bash
memory_write target=long_term \
  content="Use bun not npm for TypeScript projects." \
  tags='["prefer_pattern","tooling"]' \
  confidence=0.88
```

High-confidence active records with `ruleType` in `["avoid_pattern","prefer_pattern","correction","convention"]` may render as **hard rules** after scope and positive applicability filtering. A writing preference is injected for relevant writing or documentation tasks, not for unrelated coding work.

## Curation modes

```text
memory_write target=long_term     -> inbox candidate
LLM consolidation                 -> inferred inbox candidate
Direct preference or correction   -> checkpointed inbox candidate
Repeated equivalent preference    -> recurrence on existing candidate
                                             |
                                             v
                                governed review and patch proposal
                                global preference: explicit review
                                project group: one op per target
                                             |
                                             v
                                  selected patch operations apply
```

## Memory search

```bash
memory_search "memory governance"        # built-in FTS, instant, no deps
memory_search "vault promotion" --mode=semantic   # qmd semantic (needs embeddings)
```

The built-in FTS index (`bun:sqlite`) is always available. Semantic search requires qmd embeddings to be generated (`qmd embed`).

## Session decisions

Tag important decisions in daily notes:
```bash
memory_write target=daily content="#decision use canonical JSONL not markdown as source of truth"
```

Surface later:
```bash
session_decisions --days=30
```

## Vault promotion

Promote only when:
1. Observed in 2+ independent projects
2. Stable for at least 30 days
3. Reusable as domain knowledge, not merely personal preference
4. Citation/provenance can be represented in the vault

Set `PI_VAULT_PATH` to enable `vault_ref` auto-suggestions during `/curate-memory`.

## KV-cache efficiency

Memory injection uses a per-turn custom message rather than system prompt mutation. The system prompt stays stable across turns, preserving the provider's KV-cache prefix. Never inject memory by mutating the system prompt.

## Context injection priority

Under the 14 KB budget:
1. **Hard rules**: applicable high-confidence typed corrections
2. **L1 identity**: always included
3. **Scratchpad**: active task items
4. **L2 selected**: FTS or hybrid matched records
5. **Daily digest**: `#decision` markers and session count

Positive applicability is evaluated before hard-rule rendering. The total default budget remains 14 KB, including a 2 KB hard-rule cap. Capture metadata, activity ledgers, checkpoints, and recurrence history are not injected as prose.
