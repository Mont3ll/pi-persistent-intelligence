# Shared PI Memory Contract

The shared PI memory contract is the compatibility layer used to exchange governed memory between PI memory implementations.

It defines common terminology, record shapes, status mapping, safety expectations, and import/export semantics. It does not make one runtime depend on another.

## What it is for

Use the contract when you want to move or compare governed memory between compatible tools, including:

- `pi-persistent-intelligence`, the lightweight pi-agent-native memory extension.
- `pi-governance-rs`, the standalone Rust CLI/MCP governed memory runtime.

Either project can be used alone. Interoperability happens through compatible bundles, not through a mandatory shared process.

## Shared concepts

| Concept | Meaning |
|---|---|
| **record** | A governed memory claim with identity, namespace/profile/project scope, layer, kind, trust, durability, evidence, verification metadata, and status. |
| **candidate** | A captured observation awaiting review. Candidates can become proposed patches. |
| **patch** | A reviewable proposed mutation with `proposed`, `applied`, `rejected`, or `deferred` status. |
| **evidence** | Source support or qualification for a record or candidate. |
| **inquiry** | An open question created when capture is ambiguous, contested, or underspecified. |
| **session entry** | L3/daily/session context. It can support future memory but is not authoritative L1/L2 memory. |
| **reinforcement event** | Explicit reinforcement, implicit success, neutral exposure, or correction signal. |
| **redaction metadata** | Best-effort fields checked, fields redacted, and user-review notes for export. |

## Shared layers

| Contract layer | pi-persistent-intelligence | pi-governance-rs |
|---|---|---|
| `l1_identity` | L1 identity records | `layer: l1_identity` |
| `l2_playbook` | L2 playbooks | `layer: l2_playbook` |
| `l3_session` | Daily/session context | `layer: l3_session` |

## Shared status mapping

| pi-persistent-intelligence status | Contract / pi-governance-rs status |
|---|---|
| `active` | `active` |
| `deprecated` | `tombstoned` in conservative mode |
| `deleted` | `deleted` or `tombstoned`, depending on import mode |
| `contested` | `contested` |
| `superseded` | `superseded` |
| candidate/inbox `new` | patch `proposed` |
| candidate `patched` | patch `applied` |
| candidate `rejected` | patch `rejected` |
| deferred candidate | patch `deferred` |

## Shared safety rules

- L1 identity records are never auto-applied.
- Capture creates candidates or L3/session evidence, not silent L1/L2 mutation.
- Low-trust sources cannot auto-apply.
- Repository, generated, and third-party content require review.
- Tombstones prevent re-promotion.
- Redacted export is best-effort and should be user-reviewed.
- Imports should be previewable before writing durable memory.

## What import/export compatibility means

A pi-governance-compatible bundle preserves the portable parts of memory: records, patches, evidence, inquiries, sessions, reinforcement events, tombstones, redaction metadata, and mapping fields such as `memory_kind`, `rule_type`, `trust_class`, and layer/status names.

`pi-persistent-intelligence` imports are merge-oriented and dry-run by default. Proposed changes route through governed review flows.

## What the contract does not guarantee

The contract does not guarantee identical UI, identical retrieval ranking, identical storage paths, identical diagnostics output, or identical runtime behavior. It is a portability and governance compatibility layer, not a requirement that both runtimes share one implementation.
