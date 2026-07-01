# Standalone vs Shared Mode

`pi-persistent-intelligence` defaults to standalone JS mode. Bridge diagnostics and pi-governance-compatible import/export are optional.

## Standalone JS mode

This is the default mode and requires no Rust runtime.

`pi-persistent-intelligence` provides pi-agent-native memory features:

- `memory_write target=daily`
- `memory_write target=long_term`
- inbox candidates and patch review
- memory-worth scoring
- memory search
- session search and decisions
- Recall X-ray
- diagnostics
- optional Obsidian vault workflows

This mode is valid even when `pi-governance-rs` is not installed.

## Standalone Rust mode

`pi-governance-rs` can be used independently as a standalone Rust CLI/MCP governed-memory runtime for MCP-capable tools.

This mode does not require `pi-persistent-intelligence`.

## Shared import/export mode

Shared mode means exchanging PI memory contract bundles between the two projects.

Use this when you want:

- pi-agent-native capture and review UX from `pi-persistent-intelligence`;
- portable PI memory contract bundles;
- optional movement of memory data into or out of `pi-governance-rs`.

Shared import/export does not create an MCP server in this package and does not make either project depend on the other.

## Optional bridge diagnostics mode

The bridge is disabled by default:

```json
{
  "piGovernance": {
    "enabled": false,
    "mode": "external",
    "command": null,
    "store": null,
    "namespace": "default"
  }
}
```

Enable it only when you intentionally want diagnostics against an external Rust runtime.

Run:

```bash
/memory-governance doctor
```

Disabled standalone JS mode is valid. The doctor is a configuration check, not a requirement to install or run Rust.

## Quick decision table

| Goal | Mode |
|---|---|
| Use governed memory inside pi-agent only | Standalone JS mode |
| Use governed memory through MCP clients | Standalone Rust mode with `pi-governance-rs` |
| Move memory between compatible runtimes | Shared import/export mode |
| Check optional external Rust runtime configuration | Optional bridge diagnostics mode |
