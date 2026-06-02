# Memory Model

PI separates memory into three layers with different governance rules, plus several supporting stores.

---

## The three layers

### L1 Identity

L1 holds fundamental preferences and principles. These are the beliefs that should almost never change and have the highest governance requirements.

- Requires explicit human ratification
- Never auto-applied in any governance mode
- Always treated as `risk: high` in the patch system
- Examples: deep language preferences, fundamental workflow principles, core constraints

### L2 Playbooks

L2 holds evolving workflow patterns, project conventions, tool preferences, and corrections. This is the productive working layer.

- Patch-governed; eligible for tiered auto-apply when evidence and trust thresholds are met
- Decays when overdue for review (via `/maintain-memory`)
- Examples: "always run typecheck before pushing", "use bun not npm in this project", "this module uses event-sourcing"

### L3 Session

L3 is the fast lane. Daily logs, scratchpad, in-progress notes. Freely writable and not curated.

- Written directly via `memory_write target=daily`
- Injected as a structured digest alongside long-term memory
- Not curated; rolls off naturally
- Used for `#decision` markers that surface in `session_decisions`

---

## Supporting stores

Beyond L1/L2/L3, PI maintains several additional stores:

| Store | What it holds |
|---|---|
| `memory/evidence.jsonl` | Structured evidence records with trust classes and source excerpts |
| `memory/reinforcement.jsonl` | Reinforcement outcome events linked to L2 records |
| `memory/inquiries.jsonl` | Open questions surfaced when relevant to the current context |
| `memory/tombstones.jsonl` | Content-free markers for deleted records; prevent re-promotion |
| `memory/profiles.jsonl` | Profile and project identity metadata |

---

## Record schema

Each L1 and L2 record contains:

```jsonc
{
  "id": "mem_20260520_abc",
  "layer": "L2",
  "profile_id": "project:my-project",
  "scope": { "type": "global" },
  "tags": ["tooling", "workflow"],
  "statement": "Use bun not npm for local development in this project.",
  "evidence": [
    { "type": "user_correction", "ref": "daily/2026-05-20.md", "note": "User stated this directly." }
  ],
  "confidence": 0.92,
  "stability": "semi-stable",
  "status": "active",
  "normalized_key": "project-my-project|global|global|tooling|prefer_pattern",
  "applies_when": [],
  "does_not_apply_when": ["publishing to npm registry"],
  "known_exceptions": ["CI publish step uses npm explicitly"],
  "review": {
    "cadence_days": 30,
    "next_review": "2026-06-20",
    "change_condition": "If the project moves away from bun."
  },
  "supersedes": [],
  "superseded_by": [],
  "vault_ref": null,
  "ruleType": "prefer_pattern"
}
```

Key fields explained:

- `profile_id`: which memory profile this record belongs to; cross-profile injection is blocked
- `normalized_key`: deterministic key used for conflict detection and candidate matching
- `applies_when` / `does_not_apply_when` / `known_exceptions`: exception and negative scope fields; used by the processor pipeline to exclude records when the context matches
- `stability`: `low`, `semi-stable`, or `stable`; affects decay rate and maintenance recommendations
- `status`: `active`, `contested`, `deprecated`, `superseded`, or `deleted`

---

## Rule types

The `ruleType` field classifies a record for better retrieval and injection formatting.

| ruleType | Injected as | Example |
|---|---|---|
| `avoid_pattern` | `⚠️ AVOID:` | "Don't use echo >> for file writes" |
| `prefer_pattern` | `✓ PREFER:` | "Use bun not npm in this project" |
| `convention` | `📌 CONVENTION:` | "This project uses event-sourcing for orders" |
| `correction` | `📌 RULE:` | General user-stated correction |
| `architecture` | (Selected Memory) | "Auth service owns all JWT validation" |
| `workflow` | (Selected Memory) | "Always run typecheck before pushing" |
| `preference` | (Selected Memory) | "Use conventional commits" |
| `testing` | (Selected Memory) | "Integration tests should not be mocked" |
| `tool` | (Selected Memory) | "Use sed for vault note insertion" |

Records with `ruleType` in `[avoid_pattern, prefer_pattern, convention, correction]` and confidence above the hard-rule threshold become **hard rules** and are injected at the top of the context block. Hard rules are always `status: active`. Contested records never appear as hard rules.

---

## Scopes

Records can be scoped:

| Scope type | Meaning |
|---|---|
| `global` | Applies across all contexts for this profile |
| `project` | Applies only when the current project matches |
| `domain` | Applies to a specific domain tag set |

Project-scoped records from a different project are excluded by the BasicScopeProcessor before injection.

---

## Profile identity

PI resolves a profile for each session based on the working directory. Resolution order:

1. Explicit `projectIdentity` in `.pi/settings.json`
2. Git remote hash
3. Git root hash
4. Nearest `package.json` name
5. Current directory basename

Profile-scoped records from one project do not appear in another project's injection context.

See [Configuration](configuration.md) for project-local memory setup.
