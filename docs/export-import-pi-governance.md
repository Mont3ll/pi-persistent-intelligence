# Export and Import with pi-governance-rs

## Export Bundle Shape

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

## Conservative Defaults

- Exports preserve L1/L2 records and L3 daily/session entries.
- `ruleType` maps to `rule_type`.
- `memory_kind`, evidence IDs, tombstones, inquiries, and reinforcement are preserved where possible.
- Private session excerpts are omitted in redacted exports.
- Imports are dry-run by default.
- Imports are merge-only and skip duplicate IDs.
- Proposed Rust patches import as reviewable inbox candidates.
- L3/session entries import into daily/session context rather than authoritative L1/L2 memory.

## Examples

```text
/memory-export --format pi-governance --output /tmp/pi-demo-store/bundle.json
/memory-export --format pi-governance --redacted --output /tmp/pi-demo-store/redacted-bundle.json
/memory-import --format pi-governance /tmp/pi-demo-store/bundle.json
/memory-import --format pi-governance /tmp/pi-demo-store/bundle.json --apply
```

Review dry-run output before applying imported bundles.
