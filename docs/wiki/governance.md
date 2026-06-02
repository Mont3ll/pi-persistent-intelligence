# Governance

PI has two governance modes that control how aggressively candidates are auto-applied.

---

## Governance modes

Configure in `~/.pi/agent/pi-memory/config.json`:

```json
{
  "governance": {
    "mode": "compatibility"
  }
}
```

### Compatibility mode (default)

Legacy memory records and candidates without trust metadata remain auto-eligible. This preserves existing behavior for records written before the evidence and trust system was added.

Use compatibility mode when:
- You are migrating from an older version of PI
- You have existing memory records without trust metadata
- You want minimal friction for low-risk personal workflows

### Strict mode

Candidates must carry trust metadata, a `verified` verification status, and at least one evidence ID before they are default-selected for auto-apply. Candidates that pass all checks but lack this metadata stay in the inbox for manual review.

Use strict mode when:
- You want every promoted belief to have a traceable source
- You are using PI in team or shared-context workflows
- You prefer explicit review over convenience

To enable strict mode:

```json
{
  "governance": {
    "mode": "strict"
  }
}
```

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
  - Governance mode allows (compatibility: legacy candidates also eligible; strict: must have trust metadata + verified status + evidence IDs)

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
