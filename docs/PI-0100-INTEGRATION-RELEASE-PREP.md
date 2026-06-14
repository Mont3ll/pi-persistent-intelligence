# PI 0.10.0 Integration and Release Prep

Date: 2026-06-14
Branch: main
Commit: `a2f810f` (`feat(memory): prepare 0.10.0 recall transparency release`)
Runtime: Bun 1.3.13, Node v24.15.0, npm 11.12.1
Package version: 0.10.0

## Executive summary

Sprint 0.10 and its follow-up were integrated into the main repository and prepared as the 0.10.0 package state. The release adds recall transparency, memory-worth scoring, local background analysis/reporting, codebase-analysis evidence capture, memory-kind reporting, Retain/Recall/Reflect documentation, docs-contract tests, and replay-style eval coverage.

The package was not published.

## Integrated work

- `/memory-recall-xray <query>` read-only recall explanation report.
- Explicit hard-rule attribution in Recall X-ray.
- Memory-worth scoring with `reject`, `daily_only`, `candidate`, and `inquiry` decisions.
- Memory-worth integration into manual long-term capture, session consolidation, and context compaction.
- `/memory-background enqueue|run|list` for local report-producing jobs.
- Background runners for diagnostics, provenance liveness, re-verification, memory graph, memory timeline, procedure candidates, and memory-worth review.
- Optional `memory_kind` taxonomy: `fact`, `event`, `instruction`, `task`.
- `codebase_analysis` evidence metadata and `/memory-evidence add-codebase-analysis`.
- Retain/Recall/Reflect public documentation.
- Procedure candidate export-boundary metadata.
- Docs-contract tests.
- Replay-style eval scenarios.

## Files changed

- `CHANGELOG.md`
- `README.md`
- `package.json`
- `docs/PI-0100-INTEGRATION-RELEASE-PREP.md`
- `docs/PI-SPRINT-010-FOLLOW-UP-RECALL-ATTRIBUTION-OPS.md`
- `docs/PI-SPRINT-010-RECALL-TRANSPARENCY-BACKGROUND-OPS.md`
- `docs/dogfood-checklist.md`
- `docs/retain-recall-reflect.md`
- `docs/wiki/commands-and-tools.md`
- `docs/wiki/index.md`
- `docs/wiki/memory-model.md`
- `eval/run-evals.ts`
- `index.ts`
- `src/background-analysis.ts`
- `src/consolidator.ts`
- `src/context-compaction.ts`
- `src/curator.ts`
- `src/diagnostics.ts`
- `src/inbox.ts`
- `src/memory-kind.ts`
- `src/memory-worth.ts`
- `src/procedure-candidates.ts`
- `src/recall-xray.ts`
- `src/types.ts`
- `test/docs/docs-contract.test.ts`
- `test/unit/background-analysis.test.ts`
- `test/unit/codebase-evidence.test.ts`
- `test/unit/consolidator.test.ts`
- `test/unit/context-compaction.test.ts`
- `test/unit/memory-evidence-command.test.ts`
- `test/unit/memory-kind.test.ts`
- `test/unit/memory-worth.test.ts`
- `test/unit/procedure-export-boundary.test.ts`
- `test/unit/recall-xray.test.ts`

## Version and changelog

- `package.json` was bumped from `0.9.0` to `0.10.0`.
- `CHANGELOG.md` now includes a `0.10.0` release section dated 2026-06-13.
- The changelog records added commands, background runners, memory-worth scoring, codebase evidence, governance notes, and verification commands.

## README/docs updates

- README documents the new commands and concepts.
- README links to `docs/retain-recall-reflect.md`.
- README documents Recall X-ray, memory-worth decisions, background operations, codebase-analysis evidence, and governance boundaries.
- Wiki command docs and memory model docs were updated.
- Package `files` now includes public docs only: `docs/wiki` and `docs/retain-recall-reflect.md`; sprint and integration reports are retained in the repo but excluded from the npm package.

## Verification results

| Command | Result | Notes |
|---|---|---|
| `bun run typecheck` | Pass | `tsc --noEmit` completed with exit 0. |
| `bun test` | Pass | 331 pass, 0 fail, 805 assertions across 80 files. |
| `bun run eval` | Pass | 33/33 eval categories passed. |
| `bun run build` | Unavailable | No `build` script exists; command returns `Script not found "build"`. |
| `npm pack --dry-run` | Pass | `pi-persistent-intelligence@0.10.0`, 84 files, package reports excluded. |

## Package dry-run

`npm pack --dry-run` produced a dry-run package for `pi-persistent-intelligence@0.10.0`.

- Package size: 140.6 kB.
- Unpacked size: 518.2 kB.
- Total files: 84.
- Public docs included: README, CHANGELOG, LICENSE, `docs/wiki`, `docs/retain-recall-reflect.md`.
- Tests excluded.
- Runtime reports excluded.
- Private memory stores excluded.
- Local sprint/integration reports excluded from package by the `files` allowlist.

## Governance invariants checked

| Invariant | Status |
|---|---|
| No automatic L1 promotion | Preserved |
| No automatic skill writing | Preserved |
| Patch-before-mutation preserved | Preserved |
| Secret redaction preserved | Preserved |
| Tombstones/privacy purge respected | Preserved |
| Background jobs do not directly mutate memory | Preserved |
| Codebase evidence does not bypass review | Preserved |
| Memory-worth does not silently discard important corrections | Preserved |

## Commit and push

Commit: `a2f810f` (`feat(memory): prepare 0.10.0 recall transparency release`)
Remote: `origin` (`https://github.com/Mont3ll/pi-persistent-intelligence.git`)
Branch: `main`
Push result: pushed `main` to `origin` (`69d6c45..a2f810f`)

## Remaining release steps

- npm publish not run.
- Create GitHub release if desired.
- Tag release if desired.
- Publish package only after explicit approval.

## Final verdict

Ready for the 0.10.0 release-prep commit and push. Do not publish until explicitly instructed.
