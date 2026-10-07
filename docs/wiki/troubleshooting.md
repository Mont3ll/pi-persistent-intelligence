# Troubleshooting

## Inbox overlay does not appear

**Cause:** Fewer than `inboxPromptThreshold` (default: 3) pending candidates.

**Fix:** Check the candidate count:

```bash
/memory-inbox
```

To lower the threshold or always show the overlay:

```json
{
  "curator": {
    "inboxPromptThreshold": 0
  }
}
```

---

## Pressing `a` in the inbox overlay does nothing

**Cause:** None of the pending operations are currently eligible for batch apply. Common reasons are low confidence, `risk: high`, `default_selected: false`, review-only verification, conflict or ambiguity, or current capture-policy revalidation holding a stale candidate as temporary, task-bound, or non-memory.

Pressing `a` applies only operations that are already safe and default-selected. It does not override a hold. If nothing qualifies, the inbox stays populated.

**Fix:** Run the full review panel:

```bash
/curate-memory
```

In the review panel you can select and apply any op, including below-threshold ones.

Alternatively, lower the threshold temporarily:

```json
{
  "curator": {
    "autoCurateHighThreshold": 0.75
  }
}
```

---

## `/curate-memory` says "No candidates meet curation thresholds"

**Cause:** Candidates exist but do not meet `minConfidence` (default: 0.75) or `minEvidenceCount` (default: 2).

Most candidates created by `memory_write target=long_term` have only one evidence reference (the daily log entry). The default threshold requires two.

**Fix:** Lower `minEvidenceCount` to 1:

```json
{
  "curator": {
    "minEvidenceCount": 1
  }
}
```

Or use `/apply-memory-patch` to apply a specific patch by ID:

```bash
/memory-patches       # find the patch ID
/apply-memory-patch patch_id_here
```

---

## Memory search returns no results

**For `mode=keyword`:**

The FTS index may be stale. Run:

```bash
/render-memory
```

This rebuilds the rendered projection and triggers an FTS sync.

**For `mode=semantic`:**

qmd embeddings may not have been generated. Run:

```bash
qmd embed
```

Then wait for embedding generation to complete before using semantic search.

---

## Session search returns no results

The session index may not have been synced. Run:

```bash
/session-sync     # sync new sessions
/session-reindex  # full re-parse if index seems stale
```

---

## Memory is not being injected

Check whether the injection filter is skipping your prompts. The filter skips: very short inputs, slash commands, and trivial acknowledgements ("ok", "yes", "thanks", etc.).

Also check profile isolation. If you are in a project-local context, records from the global profile may not be injected. Check:

```bash
/memory-doctor
```

This shows the current memory root, which indicates whether project-local storage is active.

---

## Diagnostics reports an error about tombstoned records with active status

This indicates a bug where a delete patch was applied but the record status was not updated correctly. Run:

```bash
/render-memory
```

If the issue persists after rendering, please open a GitHub issue with the output of `/memory-diagnostics --save`.

---

## The inbox overlay crashes with "Agent is already processing a prompt"

**Cause:** Pressing `r` in the inbox overlay tries to queue `/curate-memory` for after the current turn using a delivery mode that the current pi version does not support in this context.

**Fix:** Skip the overlay with `s` or `Escape`, then run:

```bash
/curate-memory
```

manually after the agent turn completes.

---

## Memory files seem corrupted or out of sync

Run diagnostics first:

```bash
/memory-diagnostics --save
```

Then review the report in `reports/diagnostics/`. For most integrity issues, the canonical JSONL is correct and only the derived files need rebuilding:

```bash
/render-memory      # rebuilds rendered/MEMORY.md
/session-sync       # rebuilds session index
```

If the JSONL itself appears corrupted, check the patches directory for the last applied patch. Each patch records the exact operations applied. The JSONL state should match the last successfully applied patch.

---

## Health audit reports duplicate normalized keys

A `duplicate_normalized_key` warning means more than one active record in the same profile has the same persisted proposition key. This can make candidate matching ambiguous even when search results still look correct.

First inspect the affected records rather than deleting one by assumption. Exact duplicates, stale persisted keys, and genuine policy conflicts need different treatment. Current v2 derivation is statement-sensitive for broad category tags, but changing a stored key still requires a governed update. Historical records should be deprecated, superseded, or audit-preserving deleted only when the lifecycle reason is clear.

---

## Evidence migration or inquiry stale-scan rejects apply

**Cause:** The canonical inputs changed after preview, or the fingerprint was copied incorrectly.

**Fix:** Run the preview again, review its findings and new fingerprint, then apply that exact fingerprint. Do not bypass drift protection. Missing legacy source paths remain unresolved findings; secret-bearing sources are intentionally blocked rather than converted into structured evidence.

---

## A correction was not added to the inbox

Task, delegated-agent, verifier, and one-off implementation wrappers are intentionally excluded from durable correction capture. Temporary guidance may be written daily-only, and ambiguous high-impact guidance may become an inquiry.

For project conventions, make the durable intent explicit. `For this project, always use YAML for fixture manifests` and `For this project, use YAML for fixture manifests going forward` are durable project instructions. `For this task, always use YAML` remains temporary, and `For this project, use YAML` by itself is not treated as durable merely because it names a project.

Use `/memory-inquiries list --status open` to inspect review questions. Use `memory_write target=long_term` when you intentionally want to submit durable memory for review.

---

## Getting help

- GitHub issues: https://github.com/Mont3ll/pi-persistent-intelligence/issues
- Review the [Diagnostics](diagnostics.md) page for integrity check details
- Review the [Safety Invariants](safety-invariants.md) page for expected behavior guarantees
