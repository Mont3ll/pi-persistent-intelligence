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
| Explicit correction ("don't use X", "prefer Y over Z") | Captured automatically via correction detection |
| Research source, citation-backed domain claim | Obsidian vault under AGENTS.md protocol |
| Stable dev pattern observed in 2+ projects for 30+ days | `promote_to_vault_candidate` patch op |

## Automatic correction capture

You do NOT need to call `memory_write` for corrections. If you say "don't use echo >> for file writes, use sed instead", the system automatically detects the correction signal in `agent_end`, infers `ruleType: "avoid_pattern"`, and adds a candidate to the inbox. Strong corrections (confidence ≥ 0.85) are auto-applied at session end.

Tag patterns detected: "don't/do not use X", "prefer/favor X over Y", "use X instead of Y", "always/never [verb]", "this project uses X", "never edit/modify".

## L1 vs L2

L1 identity/preference memory is rare and high risk:
- requires 3+ evidence instances
- confidence ≥ 0.85
- must include a falsifiable change condition
- **never** auto-applied

L2 playbook memory is the productive layer:
- requires 2+ evidence instances at apply time (1 accepted for inbox display)
- confidence ≥ 0.75
- includes ruleType, tags, evidence, stability, review cadence, change condition

## Rule types

Use the `ruleType` tag hint when calling `memory_write target=long_term` for better injection:

```bash
memory_write target=long_term \
  content="Use bun not npm for TypeScript projects." \
  tags='["prefer_pattern","tooling"]' \
  confidence=0.88
```

High-confidence records with `ruleType` in `["avoid_pattern","prefer_pattern","correction","convention"]` are promoted to **hard rules** — injected above general memory with `⚠️`/`✓`/`📌` prefixes.

## Curation modes

```text
memory_write target=long_term   →  inbox candidate
LLM consolidation (session end) →  inbox candidate (Jaccard-deduped)
Automatic correction capture    →  inbox candidate (instant)
                                          ↓
                              tiered auto-curation (session end):
                               conf ≥ 0.85  →  auto-applied to L2
                               conf < 0.85  →  held in inbox
                                          ↓
                     inbox review panel (next session start, if ≥ 3 pending)
                               [a] approve  [r] /curate-memory  [s] skip
                                          ↓
                     /curate-memory → PatchReviewPanel → applyPatch
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

Memory injection uses a per-turn custom message (not systemPrompt mutation). The system prompt stays stable across turns — preserving the provider's KV-cache prefix and saving 10× on cache-hit turns. Never inject memory by mutating systemPrompt.

## Context injection priority

Under the 14 KB budget:
1. **Hard rules** — high-confidence typed corrections (⚠️/✓/📌 prefixed)
2. **L1 identity** — always included
3. **Scratchpad** — active task items
4. **L2 selected** — FTS/hybrid matched records (staleness-tagged)
5. **Daily digest** — `#decision` markers and session count
