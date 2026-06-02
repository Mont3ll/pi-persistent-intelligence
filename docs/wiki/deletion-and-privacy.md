# Deletion and Privacy

PI provides two deletion modes with different semantics, plus tombstones that prevent deleted records from being re-promoted.

---

## Why deletion matters

Memory records may contain sensitive content, outdated beliefs, or inaccurate patterns. Proper deletion ensures:

- Deleted records do not appear in injection or search
- Privacy-sensitive content is purged rather than just hidden
- Deleted patterns cannot be re-promoted through future candidate paths

---

## Deletion modes

### audit_preserving

Marks the record as `deleted` and removes it from injection and FTS search. The statement and evidence are preserved in the JSONL audit trail.

Use `audit_preserving` when:
- The record is invalid, stale, or incorrect
- Content is not sensitive
- You want to keep the history for audit purposes

After an `audit_preserving` delete:
- Record `status` is set to `"deleted"`
- Record is excluded from all injection
- FTS index is updated so the record is not searchable
- Statement content remains in the JSONL file
- Tombstone is written to `memory/tombstones.jsonl`

### privacy_purge

Completely redacts the record content, purges linked evidence, writes a content-free tombstone, and syncs FTS immediately via `applyPatchAndSync`.

Use `privacy_purge` when:
- The record contains sensitive content (credentials, personal information, proprietary details)
- You want no recoverable content remaining in normal memory files

After a `privacy_purge` delete:
- Record `status` is set to `"deleted"`
- Statement is replaced with `[deleted]`
- Tags are cleared
- Evidence is replaced with a tombstone reference
- Linked evidence records in `memory/evidence.jsonl`:
  - `source_summary` replaced with `[deleted]`
  - `source_excerpt` removed
  - `redaction_status` set to `"deleted"`
- Content-free tombstone written (contains only deletion metadata, no original content)
- FTS synced immediately

---

## Tombstones

A tombstone is written to `memory/tombstones.jsonl` for every deletion. Tombstones contain:

- `deleted_record_id`
- `deletion_mode`
- `deletion_reason`
- `deleted_at`
- `content_hash` (for audit_preserving; not for privacy_purge)
- `content_removed: true`

Tombstones do not contain any recoverable statement or evidence content.

### Re-promotion prevention

Before any candidate is promoted to L2, the verifier checks whether the target memory ID has a tombstone. If a tombstone exists, the candidate is rejected with `verification_status: "rejected"` and `failure_reason: "tombstoned_recreation"`.

This prevents a pattern like: delete a bad memory, then have the LLM consolidator re-extract the same pattern and promote it again.

---

## Applying a delete patch

Delete operations are always `risk: "high"` and `default_selected: false`. They require explicit selection.

Via the patch review panel:

```
/curate-memory   # or
/apply-memory-patch <patch-id>
```

Select the delete op with Space and press Enter to apply.

For delete operations, `applyPatchAndSync` is used automatically, which syncs the FTS index immediately after mutation.

---

## Deletion reasons

When creating a delete patch, a `deletion_reason` is recorded:

| Reason | When to use |
|---|---|
| `user_requested` | User explicitly asked for deletion |
| `privacy_sensitive` | Content is sensitive; use with `privacy_purge` |
| `poisoned` | Record was created by a low-trust or adversarial source |
| `invalid` | Record is factually incorrect or was never valid |
| `other` | Does not fit other categories |

---

## Checking deletion results

After applying a delete patch, run diagnostics to confirm:

```
/memory-diagnostics
```

Diagnostics check for:
- Deleted records appearing in rendered Markdown (error if found)
- Tombstoned records with active status (error if found)
- Active records referencing redacted evidence (warning if found)

See [Diagnostics](diagnostics.md).
