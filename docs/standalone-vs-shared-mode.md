# Standalone vs Shared Mode

## Standalone Mode

Standalone mode is the default and requires no Rust runtime.

`pi-persistent-intelligence` provides pi-agent-native memory features:

- `memory_write target=daily`
- `memory_write target=long_term`
- inbox candidates and patch review
- memory-worth scoring
- memory search
- session search and decisions
- Recall X-ray
- diagnostics
- reports and optional vault workflows

This mode is valid even when `pi-governance-rs` is not installed.

## Shared Compatibility Mode

Shared mode means exchanging PI memory contract bundles with `pi-governance-rs` through import/export.

Use this when you want:

- pi-agent-native capture and review UX from this extension
- global MCP governed memory for non-pi agents through `pi-governance-rs`
- portable reviewable memory bundles between tools

Shared mode does not create an MCP server in this package and does not require either project to depend on the other.

## Optional Bridge Configuration

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
