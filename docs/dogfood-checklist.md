# PI Persistent Intelligence -- Dogfood Checklist

Manual verification checklist for `pi-persistent-intelligence` current candidate behavior. Run through these checks in a real pi session to confirm end-to-end behavior before publishing.

---

## 1. Install and setup

- [ ] `pi install npm:pi-persistent-intelligence && /reload`
- [ ] `/memory-doctor` -- confirm memory root, FTS status, governance mode, inbox count
- [ ] No errors on reload

---

## 2. Automatic correction capture

- [ ] In any session, type: `"Don't use npm here, always use bun for local tests."`
- [ ] Start a new session -- inbox review panel appears (or run `/memory-inbox`)
- [ ] Confirm candidate has `ruleType: avoid_pattern` or `prefer_pattern` and a high confidence score
- [ ] Dismiss the panel with `q` -- candidate stays in inbox

---

## 3. Manual memory write

- [ ] Run: `memory_write target=long_term content="Use bun for integration tests." tags='["testing","workflow"]' confidence=0.88`
- [ ] Run `/memory-inbox` -- confirm the new candidate appears

---

## 4. Inbox review and curation

- [ ] Run `/curate-memory`
- [ ] Review the patch review panel
- [ ] Apply at least one op with `Enter`
- [ ] Confirm: `memory_search "bun test" --mode=keyword` returns the promoted record

---

## 5. Hard rule injection

- [ ] Start a new session with a substantive prompt about tests
- [ ] Confirm the injected context includes a `## Hard Rules` section with the record (prefixed with `AVOID`, `PREFER`, or `RULE`)

---

## 6. Memory search

- [ ] `memory_search "bun" --mode=keyword` -- results returned immediately
- [ ] `memory_read target=long_term` -- shows rendered memory

---

## 7. Session search and decisions

- [ ] `session_search "bun test"` -- finds sessions mentioning it
- [ ] `memory_write target=daily content="#decision use bun not npm for test commands"`
- [ ] `session_decisions --days=1` -- decision appears

---

## 8. Diagnostics and safety reports

- [ ] Run `/memory-diagnostics` -- no errors on a clean store
- [ ] Run `/memory-diagnostics --save` -- confirm JSON report written to `reports/diagnostics/`
- [ ] Run `memory_write target=long_term` with a disposable fake GitHub-style token from the unit tests -- confirm persistence is blocked and no raw token is written
- [ ] Run `/memory-graph --save` -- confirm JSON report written to `reports/memory-graph/`
- [ ] Run `/memory-timeline --save` -- confirm JSON report written to `reports/timeline/`
- [ ] Run `/memory-handoff --goal "Finish validation safely"` -- confirm goal handoff is background reference only
- [ ] Set `retrieval.injectionMode` to `policy_only`, run `/reload`, and confirm injected context contains policy guidance without raw selected memory
- [ ] Set `retrieval.injectionMode` to `wakeup`, run `/reload`, and confirm injected context is compact
- [ ] Run `/procedure-candidates --save` -- confirm report is review-only and no `SKILL.md` file is written
- [ ] Run `/memory-recall-xray "bun test"` -- confirm it explains included and excluded memories without exposing secrets
- [ ] Run `/memory-background enqueue diagnostics`, `/memory-background enqueue reverification`, `/memory-background enqueue memory_graph`, `/memory-background run`, and `/memory-background list` -- confirm inspectable report artifacts are produced and no memory record is mutated
- [ ] Run `/memory-worth "ok thanks"` -- confirm it returns `reject`; run `/memory-worth "Going forward, always run bun test before commit"` -- confirm it returns `candidate`
- [ ] Run `/memory-evidence add-codebase-analysis --tool tsc --command "bun run typecheck" --exit-code 0 --analysis-kind typecheck --summary "typecheck passed"` -- confirm evidence is created and not promoted automatically

---

## 9. Deletion

- [ ] Run `/memory-patches` -- list available patches
- [ ] Run `/apply-memory-patch <id>` -- confirm applies cleanly
- [ ] Run `memory_search` for deleted content -- confirm not returned
- [ ] Run `/memory-diagnostics` -- confirm no deleted-in-rendered findings

---

## 10. Privacy purge

- [ ] Apply a `privacy_purge` delete patch via `/apply-memory-patch`
- [ ] Confirm the statement is redacted to `[deleted]` in the JSONL store
- [ ] Confirm linked evidence content is redacted
- [ ] Confirm FTS search returns no results for deleted content
- [ ] Confirm tombstone prevents re-add

---

## 11. Governance mode (strict)

- [ ] Add `"governance": { "mode": "strict" }` to `~/.pi/agent/pi-memory/config.json`
- [ ] Add a candidate without trust metadata via `memory_write target=long_term content="strict mode test" confidence=0.9`
- [ ] Run `/curate-memory` -- confirm no default-selected ops for unclassified candidate in strict mode
- [ ] Restore `"mode": "compatibility"`

---

## 12. Contested memory injection

- [ ] Manually set a record's status to `contested` (or apply a `contest` patch)
- [ ] In a session with a relevant prompt, confirm a `## Contested Memory` section appears with warning language
- [ ] Confirm no contested record appears under `## Hard Rules`

---

## 13. Maintenance

- [ ] Run `/maintain-memory` -- shows decay patch summary
- [ ] Run `/maintain-memory --report` -- shows reinforcement-based recommendations
- [ ] Confirm no automatic stability mutation occurred without patch application

---

## 14. Meta-consolidation

- [ ] After several sessions with stable L2 patterns, run `/meta-consolidation`
- [ ] Confirm a report is generated in `reports/meta-consolidation/`
- [ ] Confirm no L1 record was added automatically
- [ ] Confirm all candidates have `l1_review_only` in the JSON report

---

## 15. Handoff snapshot

- [ ] Run `/memory-handoff`
- [ ] Confirm report appears in `reports/handoff/` with active record count, open inquiries, and selected memory
- [ ] Confirm canonical JSONL is unchanged after snapshot

---

## 16. Eval suite

- [ ] `bun run eval` -- all 14 categories pass, 7 hard invariants, zero failures

---

## 17. Project-local isolation

- [ ] Add `{project}/.pi/settings.json` with `"pi-persistent-intelligence": { "localPath": ".pi/pi-memory" }`
- [ ] Restart pi in that project -- `/memory-doctor` shows the local path
- [ ] Confirm global memory is not visible in the project context

---

## 18. Package hygiene

- [ ] `bun test` -- all tests pass
- [ ] `bun run typecheck` -- no errors
- [ ] `npm pack --dry-run` -- confirm no `reports/`, `eval/`, or `test/` files included
- [ ] Confirm README, CHANGELOG, LICENSE, and `docs/` are present in the package listing
