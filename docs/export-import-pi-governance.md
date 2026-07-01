# Export and Import with pi-governance-rs

Use pi-governance-compatible bundles to move governed memory between `pi-persistent-intelligence` and `pi-governance-rs` through the shared PI memory contract.

## Export examples

```bash
/memory-export --format pi-governance --output bundle.json
/memory-export --format pi-governance --redacted --output bundle.json
```

Redacted export omits private source excerpts where possible and includes redaction metadata for review.

## Import examples

```bash
/memory-import --format pi-governance bundle.json
/memory-import --format pi-governance bundle.json --apply --backup --redacted-aware
```

By default, import shows what would change before it writes anything. Use `--apply` only after reviewing the preview.

## Bundle shape

```json
{
  "schema_version": 1,
  "format": "pi-governance",
  "producer": {
    "name": "pi-persistent-intelligence",
    "version": "0.12.0"
  },
  "records": [],
  "patches": [],
  "evidence": [],
  "inquiries": [],
  "sessions": [],
  "reinforcement": [],
  "tombstones": [],
  "redaction": {
    "enabled": false,
    "fields_checked": [],
    "fields_redacted": [],
    "notes": []
  }
}
```

## Conservative defaults

- Exports preserve L1/L2 records and L3 daily/session entries.
- `ruleType` maps to `rule_type`.
- `memory_kind`, evidence IDs, tombstones, inquiries, and reinforcement are preserved where possible.
- Private session excerpts are omitted in redacted exports.
- Imports are dry-run by default.
- Imports are merge-only and skip duplicate IDs.
- Proposed Rust patches import as reviewable inbox candidates.
- L3/session entries import into daily/session context rather than authoritative L1/L2 memory.

## User review expectations

Import/export compatibility is designed for governed portability, not silent synchronization. Review the dry-run import output, keep backups when applying imported bundles, and treat redacted export as best-effort rather than a complete DLP guarantee.
