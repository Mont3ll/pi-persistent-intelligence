# Conflict Resolution Policy

PI treats memory as governed operational belief, not an unversioned note pile. Conflicts are reviewable events that should preserve provenance and avoid silently overwriting user intent.

## Definitions

A **conflict** exists when two active records make incompatible operational claims in the same scope, or when a candidate would change an existing rule without clear supersession evidence.

A **contested** memory is a record marked as disputed. It may be shown as warning context, but it is never injected as clean hard truth.

## Status vocabulary

- **superseded**: replaced by a newer reviewed record while preserving the old record for audit.
- **contested**: disputed and warning-only until resolved.
- **deprecated**: intentionally retired but retained for audit.
- **tombstoned**: deleted through a deletion marker; must not be re-promoted.
- **privacy-purged**: content removed for privacy; content must not leak through recall, reports, or compaction metadata.

## Resolution priority

1. Privacy purge and tombstone exclusions win over all recall and promotion paths.
2. Direct user correction or instruction outranks lower-trust inference within the same scope.
3. L1 records outrank L2 records within scope, but L1 remains review-only for promotion.
4. Project/resource-local memory outranks global memory within the matching project/resource scope.
5. Verified evidence outranks unverified evidence.
6. Higher trust class outranks lower trust class.
7. Newer evidence wins only when trust, verification, and scope also support it.

## Contested memory behavior

Contested records may appear in contested-memory warning injection, but they are excluded from hard-rule extraction and clean hard-rule Recall X-ray attribution.

## Exceptions versus conflicts

An exception narrows when a memory applies. If `does_not_apply_when` or `known_exceptions` excludes the current context, PI should omit the record rather than mark a conflict.

## User resolution workflow

Users resolve conflicts by reviewing the inbox/patch, contesting or uncontesting records, adding exceptions, superseding records, or deleting/tombstoning records through the patch lifecycle. Background jobs and reports may propose review items, but they do not directly mutate durable memory.
