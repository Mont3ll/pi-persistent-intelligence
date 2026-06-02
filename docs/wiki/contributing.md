# Contributing

Thank you for your interest in contributing to `pi-persistent-intelligence`.

---

## Getting started

```bash
git clone https://github.com/Mont3ll/pi-persistent-intelligence.git
cd pi-persistent-intelligence
bun install
```

---

## Development commands

```bash
bun test              # run all 260 unit tests
bun run typecheck     # TypeScript type checking
bun run eval          # deterministic eval suite (14 categories, 7 hard invariants)
npm pack --dry-run    # check package contents before publishing
```

All three must pass before any commit or pull request.

---

## Project structure

```
index.ts                         extension entry point
src/
  types.ts                       all types: MemoryRecord, CaptureCandidate, PatchOp, etc.
  paths.ts                       memory root resolution and path layout
  config.ts                      config loading and defaults
  jsonl.ts                       JSONL read/write helpers
  store.ts                       canonical L1/L2 store with patch-apply context enforcement
  render.ts                      Markdown projection renderer
  inbox.ts                       inbox candidate store
  curator.ts                     deterministic candidate curator
  maintainer.ts                  confidence decay patch generator
  patch.ts                       patch read/write/apply (applyPatch and applyPatchAndSync)
  retriever.ts                   context injection builder
  processors.ts                  processor pipeline (status, profile, scope, negative scope)
  profile.ts                     profile/project identity resolution
  corrections.ts                 automatic correction signal detection
  consolidator.ts                session-end LLM extraction
  evidence.ts                    evidence record helpers
  trust.ts                       trust weights, promotion eligibility, isAutoApplyEligibleCandidate
  verifier.ts                    deterministic candidate verifier
  matching.ts                    normalized key candidate matching
  memory-key.ts                  normalized memory key utilities
  maintenance.ts                 reinforcement-based maintenance recommendations
  reinforcement.ts               reinforcement event helpers
  inquiries.ts                   inquiry record helpers
  tombstones.ts                  deletion tombstone helpers
  diagnostics.ts                 memory integrity checks
  contested-memory.ts            contested memory selection and injection
  meta-consolidation.ts          meta-consolidation clustering and report generation
  injection-filter.ts            trivial prompt detection
  rules.ts                       hard rule extraction and formatting
  migration.ts                   legacy MEMORY.md importer
  vaultPromotion.ts              vault promotion report generation
  qmd.ts                         qmd command wrapper
  scratchpad.ts                  checklist helpers
  daily.ts                       daily log helpers
  llmAssist.ts                   LLM assistance config guard
  project.ts                     project identity inference
  session-search.ts              session search tools and context block
  search/
    fts.ts                       SQLite FTS5 index (bun:sqlite)
    hybrid.ts                    RRF hybrid search (FTS + semantic)
  sessions/
    parser.ts                    pi session JSONL parser
    bm25.ts                      BM25 keyword ranking
    store.ts                     session index with markdown export
    utils.ts                     shared utilities
  tui/
    PatchReviewPanel.ts          patch review component
    InboxReviewOverlay.ts        session-start inbox summary panel
    MemoryListPanel.ts           /memory-learnings browsing component
skills/
  memory-governance/             companion skill for agents
test/
  unit/                          unit tests
eval/
  run-evals.ts                   deterministic eval suite
docs/
  wiki/                          this wiki
```

---

## Adding a new feature

1. Add types to `src/types.ts`
2. Implement the module under `src/`
3. Write unit tests in `test/unit/`
4. Wire into `index.ts` if user-facing (command registration, lifecycle hooks)
5. Add an eval category in `eval/run-evals.ts` if the feature has a hard invariant
6. Update this wiki if behavior changes

---

## Test guidelines

- Use `bun:test` (`describe`, `test`, `expect`, `afterEach`)
- Create isolated temp directories for each test: `mkdtempSync(join(tmpdir(), "pi-test-"))`
- Clean up in `afterEach`
- Do not use the user's real memory root in tests
- Use `unsafeAddMemoryRecord()` for test setup; this is the explicit bypass for `addMemoryRecord()`'s patch-apply context requirement
- Test file names follow the module name: `src/evidence.ts` -> `test/unit/evidence.test.ts`

---

## Eval suite guidelines

The eval suite runs scenarios in isolated temp roots. Each category returns an `EvalResult` with:

- `category`: identifier
- `description`: what the category tests
- `pass`: boolean
- `metrics`: key measurements
- `failures`: failure messages
- `hard_invariant`: if true, failure exits the suite with code 1

Hard invariants are reserved for safety properties that must never be violated:
- Trust boundary
- Profile leakage
- Deletion/forgetting
- Inquiry cap
- Context-compaction no-mutation
- Meta-consolidation safety
- Diagnostics clean store
- Contested not in hard rules

---

## Code style

- TypeScript strict mode
- Bun-first (use `bun:sqlite`, `bun:test`)
- No emdashes in documentation or comments
- Prefer explicit over implicit
- Keep modules focused; split when a file grows unwieldy
- Evidence before assertions in tests

---

## Pull requests

- Run `bun test && bun run typecheck && bun run eval` before opening a PR
- Describe what the change does, not how it was built
- Link to relevant issues
- Public documentation changes belong in `docs/wiki/`; internal architecture notes belong in the internal wiki

---

## Reporting issues

Please include:
- PI version (`npm view pi-persistent-intelligence version`)
- pi version
- What you expected to happen
- What actually happened
- Output of `/memory-diagnostics --save` if relevant

GitHub issues: https://github.com/Mont3ll/pi-persistent-intelligence/issues
