# pi-persistent-intelligence Wiki

Welcome to the documentation wiki for `pi-persistent-intelligence` v0.9.0.

This wiki is the deeper operating manual for the package. The README covers installation and quick start. This wiki covers how the system works, why it is designed the way it is, and how to operate it effectively.

---

## Contents

| Page | What it covers |
|---|---|
| [Getting Started](getting-started.md) | Install, first session, and quick orientation |
| [Memory Model](memory-model.md) | L1, L2, L3 layers, record schema, rule types |
| [Lifecycle](lifecycle.md) | How memory flows from capture to injection to review |
| [Commands and Tools](commands-and-tools.md) | All public commands and tools with examples |
| [Governance](governance.md) | Compatibility mode, strict mode, and what never auto-applies |
| [Evidence, Trust, and Verification](evidence-trust-verification.md) | Trust classes, durability signals, and the deterministic verifier |
| [Patch Lifecycle](patch-lifecycle.md) | How every durable change goes through a patch file |
| [Deletion and Privacy](deletion-and-privacy.md) | Audit-preserving delete, privacy purge, and tombstones |
| [Retrieval and Injection](retrieval-and-injection.md) | The processor pipeline, scoped injection, and hard rules |
| [Diagnostics](diagnostics.md) | The `/memory-diagnostics` command and what it checks |
| [Safety and Explainability Reports](safety-and-explainability-reports.md) | Secret scanning, provenance liveness, graph export, timeline reports, and goal handoff |
| [Maintenance and Reinforcement](maintenance-and-reinforcement.md) | Reinforcement events, maintenance recommendations, and stability |
| [Meta-Consolidation](meta-consolidation.md) | Clustering stable L2 records into review-only L1 proposals |
| [Handoff Snapshots](handoff-snapshots.md) | Background-reference summaries of current memory state |
| [Configuration](configuration.md) | All config keys, environment variables, and project-local storage |
| [Vault Companion](vault-companion.md) | Pairing PI memory with an Obsidian LLM Wiki vault |
| [Troubleshooting](troubleshooting.md) | Common issues and how to resolve them |
| [Safety Invariants](safety-invariants.md) | The hard guarantees PI enforces and how they are verified |
| [Contributing](contributing.md) | How to contribute, run tests, and understand the codebase |

---

## What PI is

`pi-persistent-intelligence` is a local-first governed operational memory layer for the [pi](https://github.com/badlogic/pi-mono) coding agent.

It manages durable operational beliefs through evidence, trust classification, deterministic verification, patch-governed mutation, scoped injection, conflict handling, deletion with privacy purge, reinforcement feedback, diagnostics, and review-required abstraction proposals.

Canonical memory is JSONL. Markdown is a rendered projection. The JSONL is always the source of truth.

---

## Quick links

- npm: https://www.npmjs.com/package/pi-persistent-intelligence
- GitHub: https://github.com/Mont3ll/pi-persistent-intelligence
- LLM Wiki vault template: https://github.com/Mont3ll/llm-wiki-vault-template

Install:

```bash
pi install npm:pi-persistent-intelligence
/reload
```
