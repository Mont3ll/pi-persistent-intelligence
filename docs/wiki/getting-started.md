# Getting Started

## Installation

```bash
pi install npm:pi-persistent-intelligence
/reload
```

After reload, PI is active. It will begin collecting session context immediately.

---

## First session

On your first session after install, nothing happens automatically except the memory root being initialized. You can confirm the setup with:

```bash
/memory-doctor
```

This shows the memory root path, inbox candidate count, FTS status, governance mode, and vault configuration.

---

## Writing your first memory

Tag a decision in the daily log:

```bash
memory_write target=daily content="#decision use canonical JSONL as source of truth for all structured data"
```

This goes into your session log. It is not curated or promoted. It is immediately available in session search:

```bash
session_decisions --days=1
```

Propose something for durable long-term memory (goes to inbox for review, not directly to canonical storage):

```bash
memory_write target=long_term \
  content="Always run bun test and bun run typecheck before pushing." \
  tags='["workflow","testing"]' \
  confidence=0.88
```

---

## Automatic capture

You do not need to call `memory_write` for corrections. When you say things like:

- "Don't use echo >> for vault notes, use sed instead"
- "Prefer bun over npm in this project"
- "Going forward, always run typecheck before pushing"

PI detects the correction signal automatically and adds a candidate to the inbox. No command required.

---

## The inbox

Candidates accumulate in the inbox. When you have three or more pending candidates, an inbox overlay appears before your first agent turn in a new session:

```
Memory Inbox  (3 candidates pending)

  conf 0.92  Use bun not npm in this project
  conf 0.87  Run typecheck before pushing
  conf 0.78  Review the caching layer

  [A] Apply auto-eligible  [R] Review  [S] Skip
```

- `a` applies all candidates above the confidence threshold that are not `risk: high`
- `r` opens the interactive patch review panel
- `s` skips for this session

You can also check the inbox manually:

```bash
/memory-inbox
```

And run curation manually:

```bash
/curate-memory
```

---

## Searching memory and sessions

Search current memory records:

```bash
memory_search "bun test"                        # keyword search, instant
memory_search "testing workflow" --mode=semantic  # qmd semantic (optional)
```

Search past sessions:

```bash
session_search "how did we handle the Lambda timeout"
session_decisions --days=14
```

---

## Next steps

- Read [Memory Model](memory-model.md) to understand L1, L2, and L3 layers
- Read [Lifecycle](lifecycle.md) to understand how a candidate becomes a memory record
- Read [Governance](governance.md) to understand what auto-applies and what requires review
- Read [Configuration](configuration.md) to customize thresholds and behavior
