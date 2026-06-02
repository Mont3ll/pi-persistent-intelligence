# Safety Invariants

These are the hard guarantees that PI enforces. Each invariant is verified by the deterministic eval suite.

---

## Core invariants

### L1 records never auto-apply

L1 memory records are always treated as `risk: high` and `default_selected: false`. They are never applied by tiered auto-curation, by the inbox overlay `a` action, or by any automated path.

L1 ratification requires an explicit human choice through `/curate-memory` or `/apply-memory-patch`.

**Verified by:** `auto-curation.test.ts`, eval `trust_boundary`

---

### Low-trust sources cannot auto-apply

Candidates from `repository_text`, `generated_content`, and `third_party_documentation` are classified as high poisoning risk and are never auto-applied. They require explicit human review regardless of confidence score or governance mode.

**Verified by:** `trust-policy.test.ts`, eval `trust_boundary` (hard invariant)

---

### Strict mode blocks unclassified candidates

In `governance.mode: "strict"`, candidates without trust metadata, without a verified status, or without evidence IDs are blocked from being default-selected for auto-apply. Compatibility mode preserves legacy behavior for older records.

**Verified by:** `governance.test.ts`, eval `strict_governance`

---

### Deleted records are not injected

Records with `status: "deleted"` are excluded by `StatusFilterProcessor` before injection. They do not appear in hard rules, selected memory, or the contested memory section.

**Verified by:** `delete-patch.test.ts`, eval `deletion_forgetting` (hard invariant)

---

### Deleted records are not searchable after FTS sync

After a delete patch is applied via `applyPatchAndSync()`, the FTS index is synced immediately. Deleted records do not appear in `memory_search` results.

**Verified by:** `delete-patch.test.ts` (FTS sync test), eval `deletion_forgetting` (hard invariant)

---

### Tombstoned records cannot be re-promoted

The verifier checks `isTombstonedRecord()` before any candidate is promoted. Candidates targeting tombstoned record IDs are rejected with `verification_status: "rejected"` and `failure_reason: "tombstoned_recreation"`.

`applyPatch()` also throws if an `add` op targets a tombstoned ID.

**Verified by:** `delete-patch.test.ts`, `verifier.test.ts`

---

### Privacy purge leaves no recoverable content

After a `privacy_purge` delete:
- Record statement is replaced with `[deleted]`
- Tags are cleared
- Evidence records linked to the deleted memory have their `source_summary` set to `[deleted]`, `source_excerpt` removed, and `redaction_status` set to `"deleted"`
- Tombstone contains only deletion metadata, no original content

`JSON.stringify` of the purged record and linked evidence does not contain the original statement text.

**Verified by:** `delete-patch.test.ts` (privacy purge test)

---

### Cross-profile injection is blocked

The `ProfileScopeProcessor` excludes records whose `profile_id` does not match the current session's resolved profile. Records from profile `project:other` cannot appear in a session for profile `project:current`.

Records without `profile_id` (legacy records) are treated as compatible with any profile.

**Verified by:** `processors.test.ts`, eval `injection_profile_leakage` (hard invariant)

---

### Meta-consolidation never mutates L1

`/meta-consolidation` produces reports and L1 candidate proposals in `reports/meta-consolidation/`. It does not write to `memory/L1.identity.jsonl`, `memory/L2.playbooks.jsonl`, or any other canonical JSONL file.

**Verified by:** `meta-consolidation.test.ts`, eval `metaConsolidationSafety` (hard invariant)

---

### Cross-profile meta-consolidation is blocked

`clusterL2Records()` filters strictly to records matching the target `profile_id`. Records from other profiles do not appear in any cluster, regardless of normalized key match.

**Verified by:** `meta-consolidation.test.ts`, eval `metaConsolidationSafety` (hard invariant)

---

### Contested records never appear as hard rules

`extractHardRules()` filters for `status: "active"` only. Contested records with high confidence and correction rule types do not appear in the hard rules section, even if they would otherwise qualify.

**Verified by:** `rules.test.ts`, eval `contested_not_in_hard_rules` (hard invariant)

---

### Context-compaction does not mutate durable memory

`runContextCompactionConsolidation()` creates evidence records and inbox candidates. It does not write to `memory/L1.identity.jsonl` or `memory/L2.playbooks.jsonl`.

**Verified by:** `context-compaction.test.ts`, eval `context_compaction_lifecycle` (hard invariant)

---

### L1/L2 writes require patch-apply context

The public `addMemoryRecord()` function in `src/store.ts` throws if called without `PatchApplyContext`. All legitimate mutations go through `applyPatch()`, which provides this context. This prevents accidental direct writes to canonical JSONL that would bypass the patch audit trail.

**Verified by:** `store-boundary.test.ts`

---

### Inquiry cap is respected

`selectRelevantInquiries()` returns at most 3 inquiries per turn (configurable). Answered, withdrawn, and stale inquiries are never surfaced.

**Verified by:** `inquiries.test.ts`, eval `inquiry_surfacing` (hard invariant)

---

### Diagnostics clean store has no errors

A freshly generated memory store (no deleted or corrupted records) produces zero error-level findings from `/memory-diagnostics`.

**Verified by:** `diagnostics.test.ts`, eval `diagnostics_clean_store` (hard invariant)

---

## Eval suite

All invariants above are covered by the deterministic eval suite:

```bash
bun run eval
```

14 categories, 7 hard invariants. All pass on every release.
