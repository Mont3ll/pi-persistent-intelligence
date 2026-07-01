# pi-persistent-intelligence

Native governed memory for the pi coding agent: durable project memory, session search, reviewable curation, diagnostics, and optional Obsidian vault integration.

> **Canonical memory is JSONL. Markdown is a rendered projection.**

```bash
pi install npm:pi-persistent-intelligence
/reload
```

## Why it exists

Coding agents forget project conventions, previous corrections, release decisions, and workflow preferences between sessions. `pi-persistent-intelligence` gives pi a local governed memory layer that can retain useful observations, recall scoped context, and reflect on memory health without silently rewriting durable memory.

It is a standalone pi-agent-native extension. It does not require `pi-governance-rs`, does not require Rust, and does not run an MCP server.

## Install

```bash
pi install npm:pi-persistent-intelligence
/reload
```

PI stores data locally under `~/.pi/agent/pi-memory/` by default. Project-local storage can be configured with `.pi/settings.json`.

## Quick start

```bash
/memory-inbox
/curate-memory
/memory-doctor
/memory-diagnostics
```

Write a short-lived session decision:

```bash
memory_write target=daily content="#decision use canonical JSONL as the source of truth"
```

Propose durable long-term memory for review:

```bash
memory_write target=long_term \
  content="Always run bun test and bun run typecheck before pushing." \
  tags='["workflow","testing"]' \
  confidence=0.88
```

Search memory and prior sessions:

```bash
memory_search "bun test"
session_search "Lambda timeout debug"
```

See [Command reference](docs/commands.md) for the full command and tool list.

## How memory works

The public model is **Retain, Recall, Reflect**:

- **Retain** useful candidates with evidence.
- **Recall** scoped memory with policy, search, and diagnostics.
- **Reflect** through reviewable maintenance, abstraction, and procedure artifacts.

See [Retain, Recall, Reflect](docs/retain-recall-reflect.md) for the longer model.

Memory is stored as JSONL records and rendered to Markdown for inspection. The Markdown projection is not canonical.

| Layer | Store | Governance |
|---|---|---|
| **L1 Identity** | `memory/L1.identity.jsonl` | Never auto-applied; requires explicit ratification |
| **L2 Playbooks** | `memory/L2.playbooks.jsonl` | Patch-governed; confidence and evidence gated |
| **L3 Session** | `daily/YYYY-MM-DD.md` | Freely writable session context |
| **Evidence** | `memory/evidence.jsonl` | Content-addressed support, bounded excerpts, redactable |
| **Tombstones** | `memory/tombstones.jsonl` | Content-free deletion markers that prevent re-promotion |

## Core workflow

```text
observation or correction
  -> candidate + evidence
  -> verification
  -> inbox review
  -> patch-governed mutation
  -> scoped recall in future sessions
  -> diagnostics and maintenance recommendations
```

Durable memory changes are patch-governed. No record is silently mutated. Low-trust sources, generated content, repository text, contested records, and L1 identity proposals require review.

## Relationship to pi-governance-rs

The ecosystem model is:

```text
pi-persistent-intelligence
  = standalone lightweight pi-agent-native memory extension

pi-governance-rs
  = standalone Rust CLI + MCP stdio governed memory runtime

Shared PI memory contract
  = schema/import/export/terminology compatibility layer
```

`pi-persistent-intelligence` is native governed memory for the pi coding agent.

`pi-governance-rs` is the standalone Rust CLI/MCP runtime for governed memory across Codex, Claude, OpenCode, Cursor, PI agent, and other MCP-capable tools.

Both can be used alone. Both can interoperate through the shared PI memory contract, compatible import/export, and optional bridge diagnostics.

Key boundaries:

- `pi-persistent-intelligence` does **not** require Rust.
- `pi-persistent-intelligence` does **not** host or run an MCP server.
- `pi-governance-rs` remains the MCP runtime.
- Normal pi-agent usage does **not** require `pi-governance-rs`.

## Import and export

Use pi-governance-compatible bundles when you want to move governed memory between compatible runtimes:

```bash
/memory-export --format pi-governance --redacted --output bundle.json
/memory-import --format pi-governance bundle.json
/memory-import --format pi-governance bundle.json --apply --backup --redacted-aware
```

By default, import shows what would change before it writes anything. Imports are merge-oriented and route proposed changes through governed flows.

See [Export/import with pi-governance-rs](docs/export-import-pi-governance.md).

## Optional pi-governance-rs bridge

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

Run this only when you intentionally want to check optional external Rust-runtime configuration:

```bash
/memory-governance doctor
```

Disabled standalone mode is valid.

## Safety guarantees

| Invariant | Guarantee |
|---|---|
| Canonical storage | JSONL is authoritative; Markdown is rendered |
| Patch governance | Durable L1/L2 changes go through patch review/application |
| L1 identity safety | L1 records are never auto-applied |
| Trust boundaries | Low-trust/generated/repository content cannot auto-apply |
| Tombstones | Deleted records cannot be silently re-promoted |
| Privacy purge | Removes recoverable content from normal memory files |
| Redacted export | Best-effort, user-reviewed redaction metadata included |
| Contested records | Warned separately; never injected as hard rules |
| Vault integration | Optional; promotion reports do not mutate vault files automatically |
| pi-governance-rs bridge | Optional diagnostics only; no MCP server in this package |

## Documentation

- [Command reference](docs/commands.md)
- [Retain, Recall, Reflect](docs/retain-recall-reflect.md)
- [Shared PI memory contract](docs/pi-memory-contract.md)
- [pi-governance-rs compatibility](docs/pi-governance-rs-compatibility.md)
- [Standalone vs shared mode](docs/standalone-vs-shared-mode.md)
- [Export/import with pi-governance-rs](docs/export-import-pi-governance.md)
- [Wiki docs](docs/wiki/)

## Development

```bash
bun test
bun run typecheck
bun run eval
bun run test:stress
npm pack --dry-run
```

`bun run eval` runs deterministic governance, recall, package/docs, replay, and hardening checks. Replay fixtures are internal validation inputs, not public performance benchmarks.

`bun run build` is intentionally unavailable because this package has no build script.
