# Shared PI Memory Contract

`pi-persistent-intelligence` maps to the shared PI memory contract used by PI memory implementations.

## Purpose

The contract lets users exchange governed memory between standalone implementations without making one runtime depend on the other.

- `pi-persistent-intelligence` is the lightweight pi-agent-native extension.
- `pi-governance-rs` is the standalone Rust CLI/MCP governed memory runtime.
- Either project can be used alone.
- Both can exchange compatible bundles through import/export.

## Entities

- **record**: governed memory claim with `id`, `namespace`, `profile_id`, `project`, `layer`, `memory_kind`, `rule_type`, `trust_class`, `durability`, `source_kind`, evidence links, verification metadata, and status.
- **patch**: reviewable proposed mutation with `proposed`, `applied`, `rejected`, or `deferred` status.
- **candidate**: captured observation awaiting review; maps to a proposed patch.
- **evidence**: source support or qualification for a record/candidate.
- **inquiry**: open question created when capture is ambiguous or contested.
- **session entry**: L3/daily/session context; useful evidence, not authoritative memory.
- **reinforcement event**: explicit reinforcement, implicit success, neutral exposure, or correction signal.
- **redaction metadata**: best-effort fields checked/redacted and user-review notes.

## Layers

| Contract layer | pi-persistent-intelligence | pi-governance-rs |
| --- | --- | --- |
| `l1_identity` | L1 identity | `layer: l1_identity` |
| `l2_playbook` | L2 playbooks | `layer: l2_playbook` |
| `l3_session` | L3 daily/session | `layer: l3_session` |

## Status Mapping

| JS status | Contract/Rust status |
| --- | --- |
| `active` | `active` |
| `deprecated` | `tombstoned` in conservative mode |
| `deleted` | `deleted` or `tombstoned` depending import mode |
| `contested` | `contested` |
| `superseded` | `superseded` |
| candidate/inbox `new` | patch `proposed` |
| candidate `patched` | patch `applied` |
| candidate `rejected` | patch `rejected` |
| deferred candidate | patch `deferred` |

## Safety Contract

- L1 never auto-applies.
- Capture creates candidates or L3/session evidence, not silent L1/L2 mutation.
- Low-trust sources cannot auto-apply.
- Repository, generated, and third-party content require review.
- Tombstones prevent re-promotion.
- Redacted export is best-effort and user-reviewed.
