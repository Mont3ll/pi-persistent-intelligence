# Retain, Recall, Reflect

PI is a local-first governed operational memory layer for pi coding agents. Its public mental model is:

```text
Retain -> Recall -> Reflect
```

This is not chat history replay. PI stores scoped, evidence-backed operational memory with review boundaries, secret scanning, tombstones, and patch-governed durable mutation.

## Retain

**Retain** means capture observations that may be useful later, but do not silently turn them into durable truth.

Retain paths include:

- `memory_write target=daily` for ephemeral session notes and `#decision` markers
- `memory_write target=long_term` for governed inbox candidates
- automatic correction capture for explicit user corrections
- context-compaction and consolidation candidates before context is lost
- deterministic evidence records, including `codebase_analysis` evidence from tools such as `tsc`, ESLint, Vitest, Playwright, Fallow-like analysis, or custom scripts

Before long-term capture, PI can score whether an observation is worth preserving. The memory-worth decision is one of:

- `reject` -- too trivial, duplicate, unsafe, vague, or sensitive without explicit request
- `daily_only` -- useful for the current session but not durable memory
- `candidate` -- worth inbox review and possible L2 promotion
- `inquiry` -- potentially important, but underspecified or risky enough to require clarification

Retain does not bypass governance. Durable L1/L2 changes still require patch application.

## Recall

Recall now includes operator-facing diagnostics for context economy and retrieval provenance. Recall X-ray reports selected and omitted memory counts, omission reasons, approximate context size, and available FTS/semantic score provenance without changing retrieval semantics.


**Recall** means retrieve scoped memory for the current task while respecting policy filters.

Recall uses profile, resource, thread, project, status, tombstone, negative-scope, contested, and dependency-invalidated state. The default context injection remains `scoped`; lower-token `policy_only` and `wakeup` modes are also available.

Use:

```bash
memory_search "query"
/memory-recall-xray "query"
```

`/memory-recall-xray` is read-only. It explains included and excluded memories, including retrieval tier, score, evidence status, trust class, memory kind, scope mismatch, negative-scope match, tombstone state, contested status, stale status, and dependency invalidation. Reports are redacted before display.

## Reflect

Reflection now includes review-only evidence linking, failure analysis, skill draft artifacts, and background report jobs. These workflows can propose candidates or reports, but they do not directly mutate durable memory or write external skill/docs files.


**Reflect** means produce reviewable maintenance and abstraction artifacts.

Reflect operations include:

- `/memory-diagnostics`
- `/memory-graph --save`
- `/memory-timeline --save`
- `/maintain-memory --report`
- `/meta-consolidation`
- `/procedure-candidates --save`
- `/memory-background enqueue diagnostics` and `/memory-background run`

Reflect operations may produce reports, candidate patches, inquiries, or review-only procedure candidates. They must not silently mutate durable memory. Procedure candidates can suggest skill names, but PI does not write `SKILL.md` automatically.

## How this preserves governance

- L1 records are never auto-applied.
- Durable memory mutation remains patch-before-mutation.
- Strict governance mode still requires trust metadata, verification, and evidence IDs.
- Compatibility mode remains backward-compatible with older records.
- Codebase-analysis evidence is support, not automatic truth.
- Background jobs are local, inspectable, repeatable, and report-producing by default.
- Secret-like content is blocked or redacted where PI controls persistence and reporting.
- Tombstones and privacy purge remain respected.
- Contested memory is warning-only and never injected as hard truth.
