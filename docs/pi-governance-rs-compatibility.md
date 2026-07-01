# pi-governance-rs Compatibility

`pi-persistent-intelligence` can exchange PI memory contract bundles with `pi-governance-rs` while remaining a standalone pi-agent extension.

## Relationship

`pi-persistent-intelligence` is native governed memory for the pi coding agent. It does not require Rust and does not host or run an MCP server.

`pi-governance-rs` is the standalone Rust CLI/MCP runtime for governed memory across Codex, Claude, OpenCode, Cursor, PI agent, and other MCP-capable tools. It remains the MCP runtime.

Both projects can be used alone. Use both only when you want pi-agent-native memory UX and a separate global MCP governed-memory runtime.

## When to use pi-persistent-intelligence alone

Use this package by itself when you want:

- durable memory inside pi-agent;
- local JSONL-backed storage;
- inbox review and patch-governed mutation;
- session search and Recall X-ray;
- diagnostics and optional Obsidian vault integration;
- no Rust runtime and no MCP server requirement.

This is the default normal pi-agent deployment.

## When to use pi-governance-rs alone

Use `pi-governance-rs` by itself when you want a standalone Rust CLI/MCP governed-memory runtime for multiple MCP-capable tools, independent of pi-agent.

## When to use both

Use both when you want:

- pi-agent-native capture, review, and recall from `pi-persistent-intelligence`; and
- a separate `pi-governance-rs` runtime for MCP-capable clients or cross-tool workflows.

Interoperability is through the shared PI memory contract, compatible import/export, and optional bridge diagnostics.

## Export

```bash
/memory-export --format pi-governance --output bundle.json
/memory-export --format pi-governance --redacted --output redacted-bundle.json
```

API:

```ts
exportToPiGovernanceBundle(root, { namespace: "default", redacted: true })
```

Redacted export omits private source excerpts where possible and includes redaction metadata for review.

## Import

```bash
/memory-import --format pi-governance bundle.json
/memory-import --format pi-governance bundle.json --apply --backup --redacted-aware
```

API:

```ts
importFromPiGovernanceBundle(root, bundle, { dryRun: true })
```

By default, import shows what would change before it writes anything. Applied imports are merge-oriented, skip duplicate IDs, and route proposed patches through the normal inbox/candidate flow.

## Optional bridge diagnostics

```bash
/memory-governance doctor
```

When the bridge is disabled, the doctor should report standalone mode as valid. When the bridge is enabled, it checks configuration for an external Rust runtime.

The bridge does not make Rust required for normal pi-agent usage and does not add an MCP server to this package.

## What is intentionally not coupled

- No runtime dependency on `pi-governance-rs`.
- No JavaScript MCP server in this package.
- No shared storage path requirement.
- No command behavior changes for normal pi-agent memory use.
- No replacement relationship between the two projects.
