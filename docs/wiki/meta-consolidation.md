# Meta-Consolidation

Meta-consolidation clusters stable active L2 records and proposes higher-order L1 principles for human review. It is a report generator, not an automated mutation path.

---

## What meta-consolidation does

When stable L2 records accumulate over time around the same topic, rule type, or normalized key, they may collectively justify a more general L1 principle. Meta-consolidation identifies these clusters and proposes review-only L1 candidates.

Key guarantees:
- L1 candidates are never auto-applied
- Cross-profile clustering is hard-blocked
- Counterexample search is mandatory
- Reports go to `reports/meta-consolidation/`; nothing is written to canonical memory

---

## Running meta-consolidation

```bash
/meta-consolidation             # generate report only
/meta-consolidation --handoff   # also generate a handoff snapshot
```

---

## The clustering step

Meta-consolidation groups active L2 records within a single profile by normalized key and rule type.

Records excluded from clustering:
- `status: "contested"`, `"deprecated"`, `"superseded"`, or `"deleted"`
- Records from other profiles

The minimum cluster size is controlled by `metaConsolidation.min_l2_records` (default: 2).

---

## Counterexample search

Before proposing an L1 candidate from a cluster, meta-consolidation performs a mandatory counterexample search. This checks:

- Contested records in the source set
- Tombstones for any source memory ID
- Open inquiries in the same profile and topic
- Redacted or deleted evidence linked to source memories
- Records from other profiles with the same normalized key (possible cross-profile contradiction)

Results are included in every L1 candidate proposal. If tombstones or contested records are found in the source set, that cluster is skipped entirely.

---

## L1 candidate proposals

Each proposed L1 candidate includes:

- `proposed_layer: "L1"`
- `promotion_eligibility: "l1_review_only"` (never auto-applies)
- `source_l2_ids`: the L2 records the proposal abstracts from
- `source_evidence_ids`: evidence from source records (excluding redacted)
- `proposed_applies_when`, `proposed_does_not_apply_when`, `proposed_known_exceptions`: merged from source records
- `counterexample_search`: the full counterexample search result
- `rationale`: human-readable explanation of why these records were clustered

---

## What to do with proposals

After `/meta-consolidation` runs:

1. Read the report in `reports/meta-consolidation/<timestamp>.md`
2. Review the proposed statement, source records, and counterexample results
3. If the proposal is sound, manually construct a patch to add the L1 record

There is no automated path from a meta-consolidation proposal to an L1 record. This is intentional. L1 ratification requires a human to confirm:
- The proposed statement is accurate
- The counterexample search is complete
- The exceptions and negative scope are correct
- The change condition is appropriate

---

## Configuration

```json
{
  "metaConsolidation": {
    "enabled": false,
    "cadence": "manual",
    "min_l2_records": 2,
    "min_reinforcement_score": 0,
    "max_candidates_per_run": 5,
    "max_input_records": 50,
    "require_counterexample_search": true
  }
}
```

The `enabled` field does not gate the `/meta-consolidation` command; the command always runs on demand. The config block controls the limits used when the command runs.

Lowering `min_l2_records` may produce more proposals but with less evidence backing. Raising `max_candidates_per_run` may produce larger reports.

---

## Reports

Reports are written to `reports/meta-consolidation/` with two files per run:

- `<timestamp>.md`: human-readable report with clusters, counterexample results, and proposed candidates
- `<timestamp>.json`: machine-readable run record
- `<timestamp>-artifact.json`: exportable artifact metadata

These files are excluded from the npm package.
