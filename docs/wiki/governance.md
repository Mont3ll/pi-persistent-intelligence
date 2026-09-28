# Governance

PI has two governance modes that control trust gates, auto-application, and directive policy authority.

---

## Governance modes

New PI stores default to strict governance. Pre-existing stores that do not yet have an explicit governance setting are marked as legacy and retain compatibility mode for migration. An explicit `governance.mode` in `config.json` remains authoritative in either direction.

Configure explicitly in `~/.pi/agent/pi-memory/config.json`:

```json
{
  "governance": {
    "mode": "strict"
  }
}
```

### Compatibility mode (legacy migration default)

Legacy memory records and candidates without trust metadata remain auto-eligible. This preserves existing behavior for records written before the evidence and trust system was added.

Use compatibility mode when:
- You are migrating from an older version of PI
- You have existing memory records without trust metadata
- You deliberately want the legacy low-friction behavior

A pre-existing store without an explicit governance setting is assigned durable store metadata with `origin: "legacy"` and `default_governance_mode: "compatibility"`.

### Strict mode (default for new stores)

Candidates must carry trust metadata, a `verified` verification status, and at least one evidence ID before they are default-selected for auto-apply. Candidates that pass all checks but lack this metadata stay in the inbox for manual review.

Strict mode also separates belief strength from directive authority. Confidence may rank a belief, but confidence alone does not make that belief policy.

Use strict mode when:
- You want every promoted belief to have a traceable source
- You are using PI in team or shared-context workflows
- You prefer explicit review over convenience

A genuinely new store is assigned durable store metadata with `origin: "new"` and `default_governance_mode: "strict"` before empty memory artifacts are materialized.

---

## Evidence, belief, and policy authority

PI distinguishes three authority planes:

- **Evidence** records source observations, user utterances, tool outcomes, tests, commits, and other support for memory claims.
- **Belief** covers preferences, claims, conventions, experiences, and learned procedures. Confidence describes belief strength.
- **Policy** covers ratified directives, hard prohibitions, operating rules, and other constraints that may be injected as hard rules.

The core invariant is:

> Confidence alone must never promote belief into policy.

In strict governance, an actionable L2 record is eligible for hard-rule authority only when:

1. `authority_plane` is `"policy"`.
2. `policy_ratification` is present.
3. The ratification method is an explicit authority path such as `direct_user_instruction`, `user_correction`, `explicit_config`, or `manual_review`.
4. The ratification contains at least one evidence reference.
5. Every ratification evidence reference is also present on the memory record.
6. The record is active and has an actionable rule type.

Malformed or incomplete policy-ratification metadata fails closed and does not create directive authority.

Confidence is not a policy threshold in strict mode. A low-confidence record with valid explicit policy ratification can carry directive authority, while a confidence-1.0 belief without ratification cannot.

Compatibility mode deliberately preserves the legacy hard-rule rule for migration: active L2 actionable records with confidence at or above 0.85 can still be treated as hard rules even when they do not contain explicit policy metadata.

---

## What never auto-applies

Regardless of governance mode, some operations always require explicit human review:

| Operation | Why it always requires review |
|---|---|
| L1 record writes | Fundamental beliefs require ratification; never auto-applied |
| Supersede operations | Replacing an existing belief is high-risk |
| Delete operations | Deletion is irreversible; always `risk: high` |
| High poisoning risk | `repository_text`, `generated_content`, `third_party_documentation` cannot auto-promote |
| `rejected` candidates | Verifier determined the candidate is unsafe for promotion |
| `review_required` candidates | Verifier found issues requiring human judgment |
| Conflict matches | Potential conflicts, supersession matches, and ambiguous matches are blocked |

---

## What can auto-apply

Under `autoCurate: "high-only"` (default), the following can auto-apply at session end:

- L2 add operations where:
  - `default_selected: true` (passes trust gate)
  - `risk != "high"`
  - `confidence >= autoCurateHighThreshold` (default: 0.85)
  - Governance mode allows it (compatibility: legacy candidates also eligible; strict: trust metadata, verified status, and evidence IDs are required)

Under `autoCurate: "all-eligible"`, all `default_selected: true` non-high-risk operations apply.

Under `autoCurate: "off"`, nothing auto-applies. You manage curation entirely through `/curate-memory`.

---

## The inbox overlay and explicit approval

When the inbox overlay appears and you press `a`, you are explicitly approving candidates. In this mode, the `default_selected` gate does not apply. All candidates above the confidence threshold that are not `risk: high` are applied.

This is an intentional distinction: background auto-curation (session end, no user present) is more conservative. Explicit user approval at the inbox overlay is less conservative because you are actively reviewing.

---

## Auto-curate settings

```json
{
  "curator": {
    "autoCurate": "high-only",
    "autoCurateHighThreshold": 0.85,
    "inboxPromptThreshold": 3
  }
}
```

| Setting | Description |
|---|---|
| `autoCurate` | `"off"`, `"high-only"` (default), or `"all-eligible"` |
| `autoCurateHighThreshold` | Confidence floor for `"high-only"` (default: 0.85) |
| `inboxPromptThreshold` | Minimum pending candidates before overlay appears (default: 3; `0` to always show; `999` to disable) |

---

## The patch boundary

All L1 and L2 write operations are enforced through a patch-apply context. The public `addMemoryRecord()` function in `src/store.ts` throws if called without this context. Legitimate mutations go through `applyPatch()` or `applyPatchAndSync()`. This ensures every durable change has a patch file before the JSONL is touched.

See [Patch Lifecycle](patch-lifecycle.md) for more.
