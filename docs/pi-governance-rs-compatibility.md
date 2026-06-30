# pi-governance-rs Compatibility

`pi-persistent-intelligence` can exchange PI memory contract bundles with `pi-governance-rs`.

## Relationship

`pi-persistent-intelligence` remains a standalone lightweight pi-agent extension. It does not require Rust and does not run an MCP server.

`pi-governance-rs` remains the standalone Rust CLI/MCP runtime for Codex, Claude, OpenCode, Cursor, PI agent, and other MCP-capable tools.

Use either project alone, or use both when you want pi-agent-native UX plus a global MCP governed memory runtime.

## Export

```text
/memory-export --format pi-governance --output /tmp/pi-demo-store/pi-memory-bundle.json
/memory-export --format pi-governance --redacted --output /tmp/pi-demo-store/pi-memory-redacted.json
```

API:

```ts
exportToPiGovernanceBundle(root, { namespace: "default", redacted: true })
```

The default export is conservative. Redacted export omits private source excerpts and includes redaction metadata.

## Import

```text
/memory-import --format pi-governance /tmp/pi-demo-store/pi-memory-bundle.json
/memory-import --format pi-governance /tmp/pi-demo-store/pi-memory-bundle.json --apply --backup --redacted-aware
```

API:

```ts
importFromPiGovernanceBundle(root, bundle, { dryRun: true })
```

Import is dry-run by default, merge-only, skips duplicate IDs, and routes proposed patches to the normal inbox/candidate flow.

## Optional Bridge Doctor

```text
/memory-governance doctor
```

When disabled, the doctor reports:

```text
pi-governance-rs bridge is disabled.
pi-persistent-intelligence standalone mode is active.
This is valid.
```

When enabled, the bridge checks configuration shape. It does not run an MCP server and does not make Rust required for normal operation.
