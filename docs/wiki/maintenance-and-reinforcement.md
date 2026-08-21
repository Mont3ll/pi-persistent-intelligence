# Maintenance and Reinforcement

PI tracks how memory records perform in practice and generates recommendations for keeping beliefs accurate over time.

---

## Reinforcement events

A reinforcement event records how a memory was encountered or acted on in a session.

Stored in `memory/reinforcement.jsonl`. Each event includes:

- `memory_id`: which record was reinforced or corrected
- `outcome`: the type of reinforcement
- `timestamp`
- Optional `evidence_id`, `profile_id`, `thread_id`, `notes`

### Outcome types

| Outcome | Meaning | Weight |
|---|---|---|
| `explicit_reinforcement` | User directly confirmed or approved the belief | +1.0 |
| `implicit_success` | One uniquely relevant active selected memory is deterministically attributed to a recorded successful test, typecheck, lint, build, or validation outcome | +0.2 |
| `neutral_exposure` | Memory was injected but not exercised | 0 |
| `explicit_correction` | User directly contradicted or rejected the belief | -1.0 |

### Conservative weighting

One explicit correction outweighs many implicit successes. This is intentional: absence of correction is weak evidence; explicit contradiction is strong evidence.

Neutral exposure does not increase stability. It is disabled by default and, when enabled, is capped at one event per memory per session. A memory being injected many times without correction is not sufficient evidence that it is correct.

Implicit success also requires explicit recorded success; silence and lack of correction are not success. Attribution considers only active, non-negative records in the selected-memory trace, then uses bounded command class, `applies_when`, and semantic operation overlap. Avoid/negative instructions are excluded because a successful command alone cannot prove that the prohibited alternative was avoided. Ambiguous attribution produces no event. At most one implicit-success event is recorded for a memory in one session, and persisted notes contain bounded attribution metadata rather than the raw command.

Use `/memory-reinforce <memory-id> --note "..."` only for direct user confirmation. The long-term memory browser also provides `r reinforce` for the highlighted record. Both paths record an event but never change confidence or stability; maintenance may later propose a governed patch.

---

## Direct preference and correction capture

PI classifies direct user turns for durable preferences, corrections, project conventions, reusable workflows, temporary instructions, and non-memory text. Explicit durable instructions are checkpointed per turn and become inbox candidates immediately, so capture does not depend on session shutdown or LLM consolidation. Temporary instructions remain daily-only. Task wrappers, quoted repository text, and secret-bearing text are rejected from durable capture.

Candidate scope comes from explicit language and bounded repository activity. A user-wide preference is proposed as global L2 and requires review. A non-global convention can produce correlated targets for every materially modified repository. The session launch directory and read-only repositories are not sufficient scope evidence.

Equivalent preferences reinforce one pending candidate by adding recurrence and source references. A changed target or applicability remains separate for review rather than being merged silently.

When a direct message is also an explicit correction, PI attempts to match it to a selected active memory from the current turn. If exactly one record clearly matches by token overlap, an `explicit_correction` reinforcement event is appended. Ambiguous corrections do not create reinforcement events, but their review candidate remains visible.

---

## Maintenance recommendations

`/maintain-memory [--report]` generates recommendations based on reinforcement summaries:

| Condition | Recommendation |
|---|---|
| `explicit_correction >= 1` | `review_memory` + `decrease_stability` (requires review) |
| `explicit_correction >= 2` | Also suggests `mark_contested_suggestion` |
| `explicit_reinforcement >= 2`, no corrections | `increase_stability` suggestion |
| `implicit_success >= 5`, no corrections | `flag_for_review` capped at `semi-stable` (not `stable`) |
| `neutral_exposure` only | No positive recommendation |
| Record overdue for review | `review_due` |

Stability suggestions:

- `decrease_stability`: if the current stability is `stable`, suggests `semi-stable`; if `semi-stable`, suggests `low`
- `increase_stability`: only from explicit reinforcement; can suggest up to `stable`
- Implicit success alone cannot promote a record to `stable`

### None of these mutations happen automatically

All stability changes require patch review and explicit selection. Generated `update_stability` operations are unselected by default, regardless of whether the proposed direction is an increase or decrease. The `/maintain-memory --report` flag shows the recommendations without generating a patch. The `/maintain-memory` command generates a patch for review.

---

## Running maintenance

```bash
/maintain-memory                  # generate patch for review
/maintain-memory --mode=auto      # apply eligible confidence-decay ops only
/maintain-memory --report         # show recommendations without generating a patch
```

The `--mode=auto` flag may apply confidence-decay operations for overdue records when they meet its existing low-risk rules.

It does not auto-apply:
- stability increase or decrease operations
- `mark_contested_suggestion` operations

Every stability change remains an unselected patch operation requiring explicit review.

---

## Confidence decay

Records that have not been reviewed by their `next_review` date have their confidence decayed by `/maintain-memory`:

| Stability | Decay per overdue cycle |
|---|---|
| `semi-stable` | -0.15 |
| `stable` | -0.05 |
| `low` | -0.15 |

Decay reduces confidence until the record is either reviewed (resetting the cadence) or deprecated.

---

## Stability patch ops

Stability changes use the `update_stability` patch op:

- `increase_stability`: low risk; applies the stability increase
- `decrease_stability`: medium risk; requires explicit selection in `/curate-memory`

The `update_stability` op is separate from the general `update` op so that stability changes can be filtered and tracked distinctly.
