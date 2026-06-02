# Memory Lifecycle

This page describes how a piece of knowledge travels from a session event to a long-term memory record, and how it is maintained and eventually retired.

---

## Overview

```
Session message or context compaction
  |
  v
Automatic correction capture  /  Session-end LLM extraction
  |
  v
Evidence record
(trust class, durability signal, content-addressed ID, bounded excerpt)
  |
  v
Candidate
(promotion eligibility, poisoning risk, conflict match metadata)
  |
  v
Deterministic verification
(source support, trust boundary, durability, conflict check, tombstone check)
  |
  v
Inbox
(verified candidates may auto-apply; review_required stays for curation)
  |
  v
Curation
(auto-apply at session end, or manual /curate-memory, or inbox overlay [A])
  |
  v
Patch file written (before mutation)
  |
  v
JSONL mutation + rendered markdown update + FTS sync
  |
  v
Scoped injection per agent turn
(processor pipeline selects relevant records)
  |
  v
Reinforcement events
(explicit correction, implicit success, neutral exposure)
  |
  v
Maintenance recommendations
(stability suggestions, review flags)
  |
  v
Meta-consolidation reports
(review-only L1 proposals; never auto-applied)
```

---

## Capture

### Automatic correction capture

Every user message is scanned at the end of each agent turn. When a correction signal is detected, PI builds an evidence record, classifies it with trust class `user_correction`, runs the verifier, and adds a candidate to the inbox. No tool call is required.

Detected patterns include:

- Explicit negation: "don't use X", "do not use X", "stop using X"
- Preference: "prefer X over Y", "favor X instead of Y", "use X instead"
- Always/never: "always run typecheck", "never edit this file directly"
- Project convention: "this project uses X", "we use X here"
- Durable-intent phrases: "going forward, prefer X before Y", "from now on, always use X", "in the future, prefer..."

The key distinction: temporal phrases like "before the meeting" or "before lunch" are not treated as corrections. Durable-intent prefixes ("going forward", "from now on") trigger detection.

### Session-end LLM extraction

When a session closes with enough messages, a lightweight LLM call extracts durable patterns from the conversation. These candidates are classified as `agent_inference` with `promotion_eligibility: "review_only"`. They are deduplicated against existing inbox and active records before entering the pipeline.

### Context-compaction consolidation

`runContextCompactionConsolidation()` can create evidence records and verified candidates before context is lost. This does not mutate L1 or L2 memory directly. It only adds to the inbox for review.

---

## Evidence and trust classification

Every candidate carries a structured evidence record with:

- `trust_class`: the authority of the source (see [Evidence, Trust, and Verification](evidence-trust-verification.md))
- `durability_signal`: `temporary`, `task`, `project`, `repository`, `long_term`, or `unknown`
- `source_summary` and bounded `source_excerpt`
- `polarity`: `supports`, `contradicts`, or `qualifies`

---

## Verification

Before a candidate enters the patch pipeline, the deterministic verifier checks:

- Does the evidence support the claim?
- Is the trust class eligible for the proposed scope and layer?
- Is the durability signal compatible with durable L2 memory?
- Does this conflict with existing active records?
- Is this attempting to recreate a tombstoned record?
- Is the evidence redacted or deleted?

Verification produces one of:
- `legacy_unverified`: candidate has no trust metadata (legacy behavior preserved in compatibility mode)
- `verified`: all checks pass; candidate may be auto-eligible
- `review_required`: one or more checks flag the candidate for human review
- `rejected`: candidate is blocked (e.g., tombstone re-creation, redacted evidence)

---

## Curation and auto-apply

After session-end consolidation, the tiered auto-curation step runs. Controlled by `config.json`:

| `autoCurate` setting | Behavior |
|---|---|
| `"off"` | Nothing auto-applies; use `/curate-memory` for everything |
| `"high-only"` (default) | Auto-apply ops where `confidence >= autoCurateHighThreshold` (default 0.85), `risk != high`, and not L1 or supersede |
| `"all-eligible"` | Auto-apply all `default_selected: true`, `risk != high` ops |

L1 candidates, supersede ops, delete ops, high poisoning risk candidates, and `rejected`/`review_required` candidates are never auto-applied.

The inbox overlay (before the first agent turn of a new session) shows pending candidates. Pressing `a` applies all candidates above the confidence threshold that are not `risk: high`. This is an explicit user approval and bypasses the `default_selected` gate.

---

## Injection

Every agent turn, the processor pipeline selects relevant records and assembles the injection block:

1. StatusFilterProcessor: excludes non-active records
2. ProfileScopeProcessor: excludes records from other profiles
3. BasicScopeProcessor: excludes records from other projects
4. NegativeScopeProcessor: excludes records whose `does_not_apply_when` or `known_exceptions` match the current context

Remaining records are ranked by FTS/hybrid search and assembled into the context block (see [Retrieval and Injection](retrieval-and-injection.md)).

---

## Reinforcement

When a correction is detected that clearly matches a recently selected memory record, PI appends an `explicit_correction` reinforcement event linked to that record.

Reinforcement events feed into maintenance recommendations and stability suggestions (see [Maintenance and Reinforcement](maintenance-and-reinforcement.md)).

---

## Review, decay, and retirement

Records that are overdue for review are flagged by `/maintain-memory`. Confidence decays slightly on each overdue cycle. The decay rate depends on stability:

- `semi-stable` records: confidence decreases by 0.15 per overdue cycle
- `stable` records: confidence decreases by 0.05 per overdue cycle

Records can be deprecated manually via `/memory-learnings` (press `d`). Deprecated records are no longer injected but remain in the JSONL audit trail.

Records with serious conflicts can be marked `contested` via the `contest` patch op. Contested records are not injected as hard rules; they appear only in the warning-only contested memory section when context-relevant.

Deletion is described in [Deletion and Privacy](deletion-and-privacy.md).

---

## Meta-consolidation

When stable L2 records accumulate into recognizable patterns, `/meta-consolidation` clusters them and proposes review-only L1 candidates. These are never applied automatically. See [Meta-Consolidation](meta-consolidation.md) for details.
