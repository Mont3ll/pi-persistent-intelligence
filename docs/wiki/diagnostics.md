# Diagnostics

The `/memory-diagnostics` command runs a battery of integrity checks on your memory store and reports findings with severity levels.

---

## Running diagnostics

```bash
/memory-diagnostics           # display results in pi
/memory-diagnostics --save    # display results and save JSON report to reports/diagnostics/
```

A clean store produces zero errors and zero warnings.

---

## Severity levels

| Level | Meaning |
|---|---|
| `ok` | Check passed; no issues found |
| `info` | Informational; no action required but worth knowing |
| `warning` | Something may need attention; system is still functional |
| `error` | Something is wrong; may affect memory integrity or injection correctness |

---

## Checks performed

### Required JSONL stores exist

Checks that `memory/L1.identity.jsonl`, `memory/L2.playbooks.jsonl`, `memory/profiles.jsonl`, `memory/evidence.jsonl`, `memory/tombstones.jsonl`, and `inbox/captured.jsonl` are all present.

Severity: `warning` if missing.

### Orphan evidence

Checks evidence records whose `related_memory_ids` references memory IDs that do not exist in the store (excluding redacted/deleted evidence).

Severity: `warning` if orphans are found.

### Tombstoned records with active status

Checks whether any record with `status: "active"` in the JSONL store has a corresponding tombstone. This should never happen after a successful delete. If it does, the record would be injected despite being tombstoned.

Severity: `error` if found.

### Contested records in hard-rule path

Checks whether any records that are `status: "contested"` would otherwise qualify as hard rules (high confidence, correction ruleType). Also checks whether any contested record appears in `extractHardRules()` output.

Severity: `error` if a contested record appears in hard-rule output (indicates a bug). `info` if a contested record would qualify as a hard rule if active (informational; verifies intentional contested status).

### Deleted records in rendered Markdown

Reads `rendered/MEMORY.md` and checks whether any record ID with `status: "deleted"` appears in the file. After a delete patch is applied, the rendered Markdown is regenerated automatically. If deleted IDs still appear, the projection is stale.

Severity: `error` if found.

### Legacy records missing fields

Checks records without `profile_id` or `normalized_key` (pre-0.8.0 records written before profile identity and normalized keys were added).

Severity: `info`. These records are handled safely by compatibility mode.

### Duplicate normalized keys

Checks whether multiple active records within the same profile share the same `normalized_key`. Duplicates can cause ambiguous candidate matching.

Severity: `warning` if found.

### Active records referencing redacted evidence

Checks active records whose `evidence` array references evidence IDs where the evidence record has `redaction_status: "deleted"` or `"redacted"`. An active record backed only by redacted evidence cannot be reliably verified.

Severity: `warning` if found.

---

## Interpreting warnings and errors

### If you see "tombstoned records with active status"

This is a bug. It means a delete patch was applied but did not correctly set the record status. Run `/render-memory` to force regeneration, then check whether the record appears in injection. If the issue persists, open a GitHub issue.

### If you see "deleted records in rendered Markdown"

Run `/render-memory` to force regeneration of the Markdown projection from canonical JSONL. The JSONL should be correct if the delete patch was applied; the rendered view just needs to be rebuilt.

### If you see "orphan evidence"

Evidence records referencing non-existent memories are harmless but wasteful. They can be cleaned up by removing the orphan evidence from `memory/evidence.jsonl` manually if you want to reduce file size.

### If you see "legacy records missing fields"

No action required. These records work correctly in compatibility mode. If you want to add `profile_id` and `normalized_key` to old records, you can do so by editing the JSONL directly (since these are additive fields that do not affect record validity).

### If you see "duplicate normalized keys"

Two or more active records share a normalized key within the same profile. Future candidates targeting this key will match as `ambiguous` and be routed to review. You may want to deprecate one of the records via `/memory-learnings`.

---

## Diagnostics report

When run with `--save`, diagnostics are written to `reports/diagnostics/<timestamp>.json`. This includes the full findings list with severity, code, message, and affected IDs.

These reports are excluded from the npm package via `.npmignore`.
