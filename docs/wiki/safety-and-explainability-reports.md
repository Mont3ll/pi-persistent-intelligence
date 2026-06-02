# Safety and Explainability Reports

PI includes read-only reporting tools that explain why memory exists, whether its support is still alive, and what needs review. These tools do not mutate canonical memory.

## Secret scanning

PI scans high-risk persistence paths for high-confidence secret-like content. If a secret is found before a long-term candidate or evidence record is written, PI blocks persistence and reports that nothing was stored.

Reports redact detected values using this form:

```text
[redacted_secret:<kind>]
```

The scanner focuses on high-confidence patterns such as API keys, GitHub tokens, AWS access keys, private key blocks, bearer tokens, and obvious `.env` secret assignments. It is conservative to reduce false positives and is not a complete DLP system.

## Provenance liveness

Provenance liveness checks whether supporting context still appears usable. It can flag:

- missing local source files referenced by evidence
- redacted or deleted evidence
- tombstoned dependencies
- project-scoped memory whose project path no longer resolves

A liveness warning does not mean the memory is false. It means the memory should be reviewed, scoped down, re-verified, or deleted through the normal patch flow.

## Dependency graph

Use:

```bash
/memory-graph
/memory-graph --save
```

The graph export includes nodes for memory records, evidence, inquiries, reinforcement events, tombstones, candidates, and related artifacts. Edges show relationships such as `supported_by`, `supersedes`, `tombstoned_by`, `related_to`, `reinforced_by`, and `matched_to`.

The export is JSON under `reports/memory-graph/` when saved. It does not require a graph database and is not a graph query engine.

## Timeline reports

Use:

```bash
/memory-timeline
/memory-timeline --memory mem_example
/memory-timeline --memory mem_example --save
```

Timeline reports show creation, update, evidence, candidate, reinforcement, inquiry, supersession, and tombstone events. They also compute effective validity at runtime.

Existing records do not need migration. If `valid_from` is missing, PI treats `created_at` as the effective start. If `valid_to` is missing, PI infers it from supersession or deletion only when rendering the report.

## Re-verification recommendations

When supporting evidence is redacted or deleted, PI recommends re-verification for dependent memories. If all structured evidence is invalidated, the recommendation is high priority. If some support remains, the recommendation is medium priority.

PI does not silently lower trust class, delete the memory, or rewrite the statement. Review happens through diagnostics, maintenance, and patch governance.

## Injection modes

Configure low-token modes in `config.json`:

```json
{
  "retrieval": {
    "injectionMode": "policy_only"
  }
}
```

Modes:

- `scoped`: default selected-memory injection
- `policy_only`: compact policy and search guidance only. Memory remains available through search tools.
- `wakeup`: compact counts, governance mode, and suggested tools

Diagnostics show the last injection mode and character count when runtime stats exist.

## Procedure candidates

Use:

```bash
/procedure-candidates
/procedure-candidates --save
```

Procedure candidate reports identify repeated stable workflow memory and render review-only procedure drafts. They preserve source memory IDs and evidence IDs, exclude contested/deleted/superseded records, redact secrets, and never write `SKILL.md` files.

## Goal handoff

Use:

```bash
/memory-handoff --goal "Finish the release safely"
```

Goal handoff summarizes active memory, open inquiries, pending candidates, diagnostics warnings, recent evidence, and validation steps as background reference. It is not a task manager and does not judge compliance automatically.
