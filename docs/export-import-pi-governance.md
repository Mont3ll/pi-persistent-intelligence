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
    "version": "0.14.0"
  },
  "records": [],
  "patches": [],
  "evidence": [],
  "inquiries": [],
  "sessions": [],
  "reinforcement": [],
  "events": [],
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

- Unfiltered exports preserve L1/L2 records and L3 daily/session entries.
- Project/profile exports select related artifacts without assigning filter values to missing source provenance. Global records remain global, domain records remain domain-scoped, and unrelated records/artifacts are omitted.
- `ruleType` maps to `rule_type`.
- `memory_kind`, evidence, patch history, tombstones, inquiries, reinforcement, and sessions are preserved across round trips.
- Private session excerpts are omitted in redacted exports.
- Imports are dry-run by default.
- Imports are merge-only and skip duplicate IDs.
- Proposed and deferred Rust patches import as reviewable inbox candidates; applied and rejected patch history retains its corresponding candidate state.
- L3/session entries import into daily/session context rather than authoritative L1/L2 memory.
- Date-only timestamps are normalized to RFC 3339 at the compatibility boundary.
- Rust stores portable auxiliary artifacts as categorized canonical events and reconstructs their bundle sections on export.
- Generic Rust events are preserved opaquely in `memory/portable-events.jsonl`; they never feed memory injection or JS runtime telemetry.
- Redacted JS exports omit opaque peer events and report the omission because their payload schema is not governed by the JS runtime.

## Snapshot reconciliation

```bash
/memory-reconcile peer-bundle.json --json
/memory-reconcile peer-bundle.json --project my-project --profile my-profile --json
```

Reconciliation compares all eight portable sections (`records`, `patches`, `evidence`, `inquiries`, `sessions`, `reinforcement`, `events`, and `tombstones`). It reports directional, matching, divergent, duplicate, and conflicting IDs. Set-like arrays are normalized, while substantive status, scope, timestamp, and claim changes remain divergent. Reconciliation never imports, applies, or chooses an authoritative peer.

## User review expectations

Import/export compatibility is designed for governed portability, not silent synchronization. Review the dry-run import output, keep backups when applying imported bundles, and treat redacted export as best-effort rather than a complete DLP guarantee.
