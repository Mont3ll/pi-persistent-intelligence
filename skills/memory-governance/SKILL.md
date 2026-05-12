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
| Session note, recent decision, in-progress context | `memory_write target=daily` |
| Durable workflow/playbook/preference | `memory_write target=long_term` as candidate, then `/curate-memory` |
| Research source, citation-backed domain claim, concept page | Obsidian vault under AGENTS.md protocol |
| Stable dev pattern observed in 2+ projects for 30+ days | `promote_to_vault_candidate` patch op |

## L1 vs L2

L1 identity/preference memory is rare and high risk:
- requires 3+ evidence instances
- confidence >= 0.85
- must include a falsifiable change condition
- never auto-apply

L2 playbook memory is the productive layer:
- requires 2+ evidence instances
- confidence >= 0.75
- includes tags, evidence, stability, review cadence, change condition

## Never write canonical long-term memory directly

Long-term memory is JSONL canonical storage. `rendered/MEMORY.md` is generated. Do not edit rendered markdown directly.

Use:

```text
memory_write target=long_term
/curate-memory
/apply-memory-patch
```

## Context injection (cache-aware)

Memory is injected as a **per-turn custom message** (`customType: pi-persistent-intelligence-context`), not by mutating the system prompt. This preserves the provider KV-cache prefix and avoids 10× cost penalties on cache-miss turns. The block is hidden from the TUI (`display: false`).

## Daily log digest

The injected daily log section is a **structured digest** — `#decision` markers, `##` headings, and session counts — not the raw log tail. Tag notable decisions explicitly:

```
memory_write target=daily content="#decision switched to custom message injection for KV-cache"
```

## LLM consolidation at session end

On `session_shutdown`, if ≥ 3 user messages accumulated, pi-persistent-intelligence spawns `pi --print` to extract candidates and adds them to the inbox. Candidates require `/curate-memory` before entering canonical memory. Use `/consolidate-memory` to trigger manually mid-session.

Override the consolidation model:

```bash
export PI_MEMORY_CONSOLIDATION_MODEL="claude-haiku-4-5-20251001"
```

## Session history search

pi-persistent-intelligence does not include session history search. Install pi-session-search for this capability:

```bash
pi install npm:pi-session-search
```

Or install the full pi-total-recall bundle:

```bash
pi install npm:pi-total-recall
```

Run `/setup-session-search` for guided instructions. The `session_search` shim tool provides guidance when pi-session-search is not installed.

## Vault promotion

Promote only when:
1. observed in 2+ independent projects
2. stable for at least 30 days
3. reusable as domain knowledge, not merely personal preference
4. citation/provenance can be represented in the vault

Vault creation remains governed by the vault `AGENTS.md` workflow.

When `PI_VAULT_PATH` is set, `/curate-memory` automatically suggests matching `[[vault-page]]` refs in the patch op rationale. Review and apply the `vault_ref` field manually when accepting the patch.

## vault_ref cross-links

When a PI memory record refers to a concept in the vault, set `vault_ref: "[[Page Title]]"` in the canonical JSONL. This creates a bidirectional link: the memory is traceable to the vault concept, and the vault concept's `# cited by` should reference the memory context.

## Paradox of Supervision (from Cognitive Debt in Agentic Coding)

Over-delegating to AI erodes the very skills needed to supervise it. Memory governance is a human-in-the-loop discipline:
- review consolidation candidates before accepting them into L2
- decay keeps stale memories from compounding into false beliefs
- patch governance ensures you can trace why a belief entered the system
