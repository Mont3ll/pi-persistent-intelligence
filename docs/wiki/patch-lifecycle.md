# Patch Lifecycle

Every durable change to L1 or L2 memory goes through a patch file before the JSONL is touched. This is the core governance mechanism that makes memory auditable and reviewable.

---

## Why patches

A patch file is written before any mutation. This means:

- You can review exactly what will change before it happens
- Applied patches create a permanent audit trail in `patches/`
- Failed or incomplete sessions cannot leave the canonical store in an inconsistent state
- Every belief change has a traceable history

---

## The lifecycle

```
candidate (with evidence + verification status)
  |
  v
curator generates patch
(one patch per curation run; may contain multiple ops)
  |
  v
patch file written to patches/
  |
  v
ops reviewed (auto-apply or manual /curate-memory)
  |
  v
selected ops applied
  |
  v
JSONL mutation
  |
  v
rendered Markdown regenerated
  |
  v
FTS index synced
```

---

## Patch op types

| Op | Risk | Description |
|---|---|---|
| `add` | low | New L2 record from inbox candidate |
| `update` | medium | Modify fields on an existing record |
| `update_stability` | low or medium | Governed stability change from maintenance recommendation |
| `flag_for_review` | low | Mark record for next review cycle |
| `decay` | low | Reduce confidence on an overdue record |
| `deprecate` | medium | Mark record deprecated (removes from injection) |
| `supersede` | high | Replace old record with new; old is marked superseded |
| `contest` | medium | Mark active record as contested |
| `uncontest` | medium | Restore contested record to active after review |
| `add_exception` | medium | Merge `applies_when`, `does_not_apply_when`, `known_exceptions` fields |
| `delete` | high | Audit-preserving or privacy-purge deletion |
| `reject_candidate` | low | Discard inbox candidate without promoting |
| `promote_to_vault_candidate` | low | Generate a vault promotion report |

High-risk ops (`supersede`, `delete`) are always `default_selected: false`. They require explicit selection in `/curate-memory` or `/apply-memory-patch`.

---

## applyPatch and applyPatchAndSync

PI provides two patch application functions:

`applyPatch(root, patch, options)`: applies the patch, mutates JSONL, regenerates markdown. Does not sync FTS.

`applyPatchAndSync(root, patch, options, ftsIndex)`: applies the patch AND syncs the FTS index atomically. Use this for delete and privacy-purge operations where immediate FTS consistency is required. The public `/apply-memory-patch` command uses this for any patch containing a delete op.

If you are applying patches programmatically, use `applyPatchAndSync` for delete operations to avoid stale search results.

---

## Reviewing patches

`/memory-patches` lists pending patch files.

`/apply-memory-patch <id>` applies a specific patch interactively.

`/curate-memory` generates a new patch from inbox candidates and opens the review panel.

In the patch review panel:
- Arrow keys or `j`/`k` navigate ops
- Space toggles selection
- Enter applies selected ops
- `q` cancels without changes

---

## Patch audit trail

Applied patches remain in `patches/` permanently. They are not deleted after application. Each patch file is a JSON document containing:

- `patch_id`
- `created_at`
- `generated_by`: `"curator"`, `"maintainer"`, or `"manual"`
- `mode`: `"propose"`, `"supervised"`, or `"auto"`
- `summary`
- `ops`: array of operations with op type, target, updates, rationale, risk, and selection state
- `status`: `"proposed"`, `"applied"`, or `"partially_applied"`
- `applied_at`
- `applied_ops` and `skipped_ops`

This provides a complete change history for every belief in the system.

---

## Write boundary hardening

The public `addMemoryRecord()` function in `src/store.ts` requires a `PatchApplyContext` object. Calling it without this context throws an error. Legitimate callers go through `applyPatch()`, which provides this context internally.

This prevents accidental direct writes to canonical JSONL that would bypass the patch audit trail. Test helpers use `unsafeAddMemoryRecord()` for setup purposes, which is not part of the public API.
