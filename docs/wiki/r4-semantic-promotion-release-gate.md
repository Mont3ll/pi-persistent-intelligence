# R4 semantic capture → governed promotion — release gate

**Decision (2026-10-31):** Do not publish or deploy another PI release that merely preserves pending candidates while failing the user's daily requirement for durable, correctly scoped automatic memory promotion. `0.17.5-rc.1` remains preserved and **unpublished**; source-aware promotion stays OFF until a successor candidate meets the product-level gates below.

## Accepted foundations

- PR #49, HEAD `c3adec0a06602cab8a9f28abc9690118dc950a3f`, independently accepted read-only source-grounded model proposal contract.
- PR #50, HEAD `58a1a443964943721739be27ddbd44ad47cbba2a`, independently accepted Pi SDK 1.4.0 tool-less worker and completion integrity.
- R3a merged `main` includes source-authenticated transcript verification and governed transactions. The R4a audit proved that source authenticity alone does not establish durable intent. Rejected PR #48 stays unmerged.

## This branch: first functional semantic capture slice

Stacked on accepted PR #50 to preserve both accepted parents. Adds:

- `src/semantic-capture-plan.ts` — converts validated atomic propositions into explicit durable/review/daily/reject routes with exact source spans and a zero-automatic-authority contract. A standing direct single-project rule is a candidate; quoted/reported, global, unknown, mixed and temporary propositions are not automatically eligible.
- `src/capture-provenance.ts`, `src/types.ts`, `src/transcript-proof.ts` — add **source v2** proposition start/end and full original SHA. The verifier authenticates the exact user turn, origin project and extracted substring, rather than imposing the legacy first-300-character prefix on a later durable proposition. Legacy v1 remains supported.
- `src/semantic-capture-materialize.ts` — safely and idempotently creates source-spanned **review-only** inbox candidates and evidence in an explicitly supplied store root. It doesn't write L1/L2 and doesn't mark model output as an independent evidence source or promotion authorization.
- `src/curator.ts`, `src/patch-direct.ts` — hold automatic selection/application of source-v2 candidates, including forged eligibility metadata and independently corroborated/above-floor candidates, until a separately verified semantic auto-authority gate is implemented.
- Focused tests cover late-proposition retention, original Pi transcript proof, retry idempotence, single direct durable vs time-bounded/quoted/global/mixed instructions, and zero canonical writes.

**Not yet implemented on this branch:** production event integration, semantic model accuracy, a trusted semantic-auto-approval credential/capability, original-turn semantic re-evaluation at write time, automatic canonical application, live backlog migration, or later-session recall acceptance. This is not merge-ready until independently verified; don't call this an automatic-promotion fix yet.

## Next implementation gates (release-blocking)

1. **Functional semantic capture acceptance:** independent exact-SHA local tests on isolated Pi SDK sessions: durable propositions that appear after 300 characters become distinct candidates with transcript-source verification; temporary/quoted/third-party material never auto-promotes; no duplicate evidence on retries.
2. **Actual model assessment benchmark:** explicit provider, model, private-data-transmission and spending authorization. Run synthetic first and private adjudicated cases only under approved privacy boundaries. Measure unsafe automatic predictions, missed durable instructions, scope/duration accuracy, false review holds, abstentions, latency and costs. Jev/Laya remains a later typed-router comparison.
3. **Governed automatic promotion:** make new semantic-capable auto promotion opt-in; strictly bind fresh full-turn authenticated source + atomically extracted statement, scope, review policy and model assessment to a proposal, then **revalidate at apply time**. No model-generated arbitrary patch ops or stored `promotion_eligibility` field can authorize writes. At least one canonical L2 add must succeed automatically from a true user convention, with repeated session restart/recall and zero unsafe writes on the frozen negative corpus. Prove above and below evidence floors, forged evidence, stale transcript, conflicting rules, global scope, temporal qualifiers and explicit opt-outs remain safe. Keep L1 identity manual.
4. **Real inbox catch-up:** quiesced original-store backup; dry-run and candidate-by-candidate reconciliation of NEW items; automatic path for justified durable candidates after semantic gates, supervised resolution for ambiguous/duplicate/superseded, governed rejection of noise, replay safety and metrics for backlog inflow/outflow.
5. **Operational release acceptance:** actual Pi TUI and narrow terminal review, cold/warm startup, transactions, recovery/privacy, context recall in later sessions, single-source and multi-session follow-through. Publish a verified successor RC only when product-level promotion and recall work, not merely when unit tests pass.

## Release-readiness metrics

Record **eligible durable candidate inflow, automatically applied L2, held for review, correctly rejected/daily-only, unsafe applied L2, missed durable input, existing pending backlog, duplicate/superseded disposition, and later-session recall success**. Never celebrate a zero-unsafe-write run that creates no useful persistent memory. A finite test corpus passing is necessary evidence, not proof of universal semantic accuracy.

No live write, merge, publish, deployment, or source-aware policy enablement is authorized by this document. Protected PRs #47/#48, accepted PRs #49/#50 and the preserved RC must remain intact.
