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
| `implicit_success` | Agent acted on the belief and no correction followed | +0.2 |
| `neutral_exposure` | Memory was injected but not exercised | 0 |
| `explicit_correction` | User directly contradicted or rejected the belief | -1.0 |

### Conservative weighting

One explicit correction outweighs many implicit successes. This is intentional: absence of correction is weak evidence; explicit contradiction is strong evidence.

Neutral exposure does not increase stability. A memory being injected many times without correction is not sufficient evidence that it is correct.

---

## Automatic correction linking

When a user message is detected as an explicit correction (via the correction signal detector), PI attempts to match it to a selected memory record from the current turn. If exactly one active record clearly matches the correction text (by token overlap), an `explicit_correction` reinforcement event is appended for that record.

If the correction is ambiguous (matches zero or more than one record), no reinforcement event is created. The correction still goes to the inbox as a candidate.

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

All stability changes require patch application. The `/maintain-memory --report` flag shows the recommendations without generating a patch. The `/maintain-memory` command generates a patch for review.

---

## Running maintenance

```bash
/maintain-memory                  # generate patch for review
/maintain-memory --mode=auto      # apply decay ops and non-review stability ops automatically
/maintain-memory --report         # show recommendations without generating a patch
```

The `--mode=auto` flag applies:
- Confidence decay ops for overdue records (these are low risk)
- Stability increase ops that do not require review (e.g. from explicit reinforcement with no corrections)

It does not auto-apply:
- `decrease_stability` ops (always require review)
- `mark_contested_suggestion` ops (always require review)

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
