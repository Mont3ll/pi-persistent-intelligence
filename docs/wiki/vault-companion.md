# Vault Companion

PI memory pairs with an Obsidian LLM Wiki vault for a two-layer knowledge persistence system.

---

## Two separate systems

**PI memory** manages operational knowledge: agent preferences, workflow corrections, project patterns, and recurring decisions. This knowledge changes frequently, does not require citation discipline, and is governed by evidence, trust, and patch governance.

**The LLM Wiki vault** manages research-grade knowledge: source summaries, citation-backed concept pages, provenance chains, and bidirectional backlinks. Every factual claim traces back to an immutable source. The LLM only appends structured metadata to sources; it never replaces source content. This design prevents knowledge-base poisoning, where AI-authored summaries get indexed alongside originals and the distinction erodes.

The two systems are separate by design. Operational preferences should not require citations. Research knowledge should not be contaminated by operational patterns.

---

## The promotion path

The connection between PI memory and the vault is explicit and reviewable. It works in one direction:

1. An operational pattern becomes stable in PI memory (L2 record with high confidence, observed across multiple sessions)
2. PI emits a `promote_to_vault_candidate` patch op, which generates a report in `reports/`
3. A human reviews the report and decides whether the pattern deserves a permanent concept page in the vault
4. If yes, the human creates the vault page following the vault's AGENTS.md schema (immutable source, citation-backed, bidirectional backlinks)
5. Once the vault page exists, the PI memory record's `vault_ref` field is updated to reference it

There is no automatic vault mutation. PI does not write to the vault. The promotion path is always human-reviewed.

---

## Setting up vault integration

Set the vault path:

```bash
# In ~/.pi/agent/pi-memory/config.json
{
  "vault": {
    "enabled": true,
    "path": "/path/to/your/obsidian/vault",
    "reportOnly": true
  }
}
```

Or via environment variable:

```bash
export PI_VAULT_PATH="/path/to/your/obsidian/vault"
```

With `PI_VAULT_PATH` set, `/curate-memory` shows `vault_ref` auto-suggestions during patch review. These are hints based on tag overlap with existing vault concept and entity pages, not guaranteed matches. Review and correct them before applying.

---

## vault_ref field

Each L2 record has an optional `vault_ref` field:

```jsonc
{
  "id": "mem_abc",
  "vault_ref": "6. Zettelkasten/Concepts/BM25 Ranking.md"
}
```

A `vault_ref` creates a soft link between the operational memory record and the vault concept page. It does not create a hard dependency; records with a `vault_ref` that no longer exists in the vault are still valid.

---

## The memory-governance skill

The `memory-governance` skill (in `skills/memory-governance/`) provides routing guidance for the agent:

| Information type | Destination |
|---|---|
| Active task or reminder | `scratchpad` |
| Session note or decision | `memory_write target=daily` with `#decision` |
| Durable workflow or preference | `memory_write target=long_term` then `/curate-memory` |
| Explicit correction ("don't use X") | Auto-captured; no action needed |
| Research finding or citation | Obsidian vault (following AGENTS.md protocol) |
| Stable dev pattern (2+ projects, 30+ days) | `promote_to_vault_candidate` patch op |

---

## LLM Wiki vault template

A ready-to-use Obsidian vault template implementing the LLM Wiki pattern is available:

https://github.com/Mont3ll/llm-wiki-vault-template

The template includes AGENTS.md schema, page type templates, the index/log/dashboard structure, and the memory-governance skill.
