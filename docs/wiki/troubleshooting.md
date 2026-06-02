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

**Cause:** All pending candidates have `confidence < 0.85` (below `autoCurateHighThreshold`), or all are `risk: high`.

Pressing `a` applies candidates above the confidence threshold that are not `risk: high`. If all candidates are below threshold, none are applied. The inbox stays populated.

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

## Getting help

- GitHub issues: https://github.com/Mont3ll/pi-persistent-intelligence/issues
- Review the [Diagnostics](diagnostics.md) page for integrity check details
- Review the [Safety Invariants](safety-invariants.md) page for expected behavior guarantees
