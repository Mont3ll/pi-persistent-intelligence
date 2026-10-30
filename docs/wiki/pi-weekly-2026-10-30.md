# PI weekly operating update — 2026-10-30

**Status: release candidate preserved; R4 semantic safety blocked; LLM semantic-assessment pilot created.**
All numbers are source-report snapshots, not a quiesced inventory or independently executed checks for this new branch.

## Release tracks

- **Live**: last independently reported runtime `0.17.4`, canonical generation 24, pending NEW 50; source-aware automatic promotion OFF. The local verifier documented unrelated host session-index/summary changes; no manual live-store writes were authorized.
- **0.17.5-rc.1**: preserved branch `release/0.17.5-rc.1-manual-acceptance` at `95056147b5690fa09a1774f7184694712e0d4bac`, unpublished and not deployed. Previously passed 918/918 unit, 67/67 eval, 4/4 stress, frozen install and packaging/import checks. The pre-R4 five-instruction 3/2/0 demonstration validated pipeline operation, **not** semantic safety. RC source-aware mode OFF by default; do not claim opt-in automatic promotion accepted.
- **R4 safety**: rejected PR #48, last independently checked source `f7e7828550020a36704d4801af82d2c30dd0b455`, tree `82de3a4a65b21f80f2303e2fa1ab8f52f4e0887c`. On 42 unseen nonambiguous labels: unsafe auto approvals 14→2, correct approvals 19→13, correct holds 6→18, false holds 2→8, uncaptured durable 1→1. 246 real governed attempts; repository tests 1078/1078, eval 67/67, stress 4/4, audit/package/TUI smoke PASS on *that* SHA. REJECT because two unseen date-qualified instructions still auto-applied at one/two evidence references. The reduction is real but not a safe semantic generalization.
- **New pilot**: `feat/r4-llm-semantic-assessment-spike` from merged R3a main. Source-span LLM contract, optional command adapter, tests and ADR; proposed, not independently verified; no live integration and no write privileges.

## What is complete

R0–R3a merged to `main`: governed transactions, source provenance, receipt replay, historical privacy-purge/recovery, FTS and scoped retrieval improvements. R4a adversarial corpus and repeated independently applied negative tests have exposed the semantic authority gap. GitHub Actions still cannot start owing to billing; manual exact-SHA local verification is the accepted release process, **not hosted CI PASS**.

## Work remaining / priorities

| Priority | Workstream | Acceptance and next action |
| --- | --- | --- |
| P0 | Semantic authority | Stop patching PR48 grammar; independently verify new read-only contract, then benchmark Pi agent vs dedicated LLM; never authorize writes from model output alone |
| P0 | 0.17.5 release decision | Explicitly decide whether to ship preserved RC as default-off maintenance release or create new hardened RC; require operator approval and exact-SHA release record |
| P0 | Live-store preservation | Quiesce writers, re-inventory current NEW/gen/transactions, hash copied backup, preserve all background intake |
| P1 | R4 proposition/context | Recover late-message instructions beyond 300-char capture, atomic spans, cross-turn endorsement, duration/scope, explicit abstention |
| P1 | Inbox #45 | Read-only per-candidate dispositions; dry-run grouped governance, duplicates, supersession, rejection, missing-source and privacy handling. No blanket apply/reject |
| P1 | TUI #45 | Real installed SDK/TUI review, approve/reject/skip, narrow 20/24/30/40/60+ cols, selection persistence, stale/zero-apply, restart recovery |
| P1 | Startup and recall #45 | Measure cold/warm startup on 685+ session archive and full inbox; bound scanning costs, recheck cross-project retrieval and next-session usefulness |
| P2 | v0.18 retrieval intelligence | Query routing, evidence/episode and historical/current search, entity aliases, ranking/evaluations after retention safety milestone |
| P2 | CI infrastructure #44 | Resolve billing-blocked GitHub Actions, confirm workflow and publication ownership before tag push |

## Release operator guardrails

Publication, install, source-aware live opt-in, backlog mutation, RC updates and merge all require separate authorization. The `0.17.5-rc.1` manual-release guide remains the authoritative process. L1 ratification and sensitive data remain human-controlled. Jev/Laya-like typed decision models remain a documented future option, not a selected implementation.

## Next independent handoff

Verify pilot HEAD/tree, clean ancestry, Bun 1.3.13 frozen install, typecheck, tests, eval 67, stress 4, packaging, and hostile model outputs (forged hash, incorrect source spans, unknown fields, multiple propositions, provider failure). Evaluate the interpretation models on isolated labelled examples and report false approval **and** false hold rates, source span fidelity, latency/cost and privacy.
