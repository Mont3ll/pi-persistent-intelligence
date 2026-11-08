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

## PR #51 independent correction — recurrence and provenance (2026-10-31)

The first PR #51 HEAD `8915a5ea59c830bf3071fe454d987e70d1a549ce` was independently **REJECTED** despite passing 960 tests, 67 evaluations, 4 stress tests and its installed SDK supervised happy path. The adversarial matrix had **25/30** passes, with four demonstrated failure classes: legacy recurrence promoted semantic evidence through two ordinary automatic L2 writes; removing v2 candidate metadata allowed another automatic write; retries duplicated evidence; and semantic v2 proof accepted a mismatched original turn ID. The local report is preserved by the verifier at `/tmp/pi-r4-semantic-capture.OoeWMN/PI_R4_SEMANTIC_CAPTURE_VERIFICATION.md`; that path is not part of the repository.

The correction branch now:
- Separates semantic proposition recurrence from ordinary legacy equivalence, maintaining distinct candidate IDs and never incrementing evidence on exact semantic replay.
- Uses a separately named, deterministic `ev_sem_` evidence identity and `appendEvidenceRecordIfMissing` for semantic and ordinary captures.
- Enforces a **semantic review lineage deny gate** derived from v2 source, candidate ID and independently stored semantic evidence (including a formerly merged legacy candidate), at evidence-floor eligibility, curator selection and governed patch application. Deleting `capture_source` cannot silently grant auto authority. Corrupt/missing v2 proof also prevents supervised application.
- Requires the authenticated original message's specific turn ID **and** full original text hash. Identical statements on different genuine user turns may be distinguished by ID; mismatched source IDs reject.
- Adds regression fixtures for both recurrence orders, metadata erasure, above-floor legacy contaminants, forged auto patches, idempotent retries and changed transcript identity at apply.

**This correction has not yet received independent verification**. Passing it would accept the supervised semantic capture path only, not semantic-model accuracy, production event integration, automatic L2 promotion or release readiness. The two previously reported automatic writes are safety regressions to prevent, not functionality to preserve.

## PR #51 second independent rejection — original proposal source rebinding

At HEAD `38bcfa2da7dfcd5b06701b5e7b9c450edb679c53` (independent tree `80581fcb14d530d1f886521317b89fe0afb9bb52`), the local verifier **REJECTED** PR #51 after reproducing a remaining **supervised original-source rebinding**. All 30 original controls passed, but expanded/diagnostic controls were **54/56**. A real curator patch selected for original user turn A applied after candidate AND independent evidence metadata were relabelled to identical-text turn B; the same exploit worked when A's transcript was subsequently changed. The unchanged proposal's `supportingEvidence` still named A. This is **not** an observed automatic-promotion bypass. Full Bun 963/963, eval 67/67, stress 4/4, release audit and 172-file parity passed on the rejected SHA, but those results do not override the source-binding failure.

The attached independent report is `PI_R4_PR51_RECURRENCE_PROVENANCE_REVERIFICATION.md`. The correction now:

- Centralizes the exact source-bound `cap_sem_` and `ev_sem_` identity formulas in `src/semantic-source-binding.ts`, shared by candidate materialization, transcript source verification and apply-time validation.
- Fails source-v2 transcript proof when source identity no longer recomputes to the original candidate/evidence IDs, even if the substituted turn has identical text and genuinely exists.
- In governed application, additionally requires the original proposal's `supportingEvidence` source snapshot to agree with the current candidate/evidence, checks the original proposal candidate ID, statement, scope and evidence reference, and requires a freshly proven matching original turn before committing.
- Adds full governed regression tests: original A + identical B positive; relabel A→B negative; changed A + B retained negative; proposal source snapshot removed negative. Each unsuccessful application must cause zero canonical L2 adds and zero generation advancement.

**The correction HEAD is not independently verified.** Legacy v1 behavior, previous recurrence/idempotence protections and the accepted PR #49/#50 commits remain unchanged. The verifier must reproduce this report's two remaining controls *and* repeat the original matrix against the precise corrected HEAD. This milestone remains supervised-semantic integrity only. Automatic semantic promotion and the next release stay blocked.

## PR #51 third independent rejection — snapshot authority fields (2026-11-08)

Verifier REJECT at HEAD `6e1dcb813441f08da30ac0dca12874a08850190c`, reconstructed tree `10d42b9af20aa98516cc8bca44e035ff83b73348`: **all 56 frozen source-rebinding controls pass**; 34/36 additional controls pass. The two remaining failures change **only the proposal's retained `supportingEvidence` snapshot**: `source_identity_quality: "unresolved"` or `trust_class: "agent_inference"`. The original candidate, stored evidence and Pi transcript still authenticate user turn A, but the changed proposal was nevertheless applied as L2. This is incomplete proposal-snapshot validation, not a new rebinding failure or automatic promotion bypass. Old-head full Bun 967/967, eval 67/67, stress 4/4, docs/audit/173-file parity/SDK smoke passed. Live state was unchanged at generation 24 / NEW 55.

The correction in `src/semantic-source-binding.ts` requires the proposed source snapshot to match **every independently persisted evidence attribute**, including quality, trust, polarity, source identity, redaction, scope and resource/profile attribution. The **only permitted difference** is that a genuine curator snapshot additionally includes the target memory ID in `related_memory_ids`; unrelated or missing relationship IDs reject. The verifier should explicitly mutate each authority field in the *proposal only*, retain a valid original turn A, and require the real governed operation to skip without any L2/generation change. Keep positive supervised A behavior, identical-text B safety, 56/56 frozen controls and the prior recurrence/idempotence guards. These edits are NOT independently verified.

## Next implementation gates (release-blocking)

1. **Functional semantic capture acceptance:** independent exact-SHA local tests on isolated Pi SDK sessions: durable propositions that appear after 300 characters become distinct candidates with transcript-source verification; temporary/quoted/third-party material never auto-promotes; no duplicate evidence on retries.
2. **Actual model assessment benchmark:** explicit provider, model, private-data-transmission and spending authorization. Run synthetic first and private adjudicated cases only under approved privacy boundaries. Measure unsafe automatic predictions, missed durable instructions, scope/duration accuracy, false review holds, abstentions, latency and costs. Jev/Laya remains a later typed-router comparison.
3. **Governed automatic promotion:** make new semantic-capable auto promotion opt-in; strictly bind fresh full-turn authenticated source + atomically extracted statement, scope, review policy and model assessment to a proposal, then **revalidate at apply time**. No model-generated arbitrary patch ops or stored `promotion_eligibility` field can authorize writes. At least one canonical L2 add must succeed automatically from a true user convention, with repeated session restart/recall and zero unsafe writes on the frozen negative corpus. Prove above and below evidence floors, forged evidence, stale transcript, conflicting rules, global scope, temporal qualifiers and explicit opt-outs remain safe. Keep L1 identity manual.
4. **Real inbox catch-up:** quiesced original-store backup; dry-run and candidate-by-candidate reconciliation of NEW items; automatic path for justified durable candidates after semantic gates, supervised resolution for ambiguous/duplicate/superseded, governed rejection of noise, replay safety and metrics for backlog inflow/outflow.
5. **Operational release acceptance:** actual Pi TUI and narrow terminal review, cold/warm startup, transactions, recovery/privacy, context recall in later sessions, single-source and multi-session follow-through. Publish a verified successor RC only when product-level promotion and recall work, not merely when unit tests pass.

## Release-readiness metrics

Record **eligible durable candidate inflow, automatically applied L2, held for review, correctly rejected/daily-only, unsafe applied L2, missed durable input, existing pending backlog, duplicate/superseded disposition, and later-session recall success**. Never celebrate a zero-unsafe-write run that creates no useful persistent memory. A finite test corpus passing is necessary evidence, not proof of universal semantic accuracy.

No live write, merge, publish, deployment, or source-aware policy enablement is authorized by this document. Protected PRs #47/#48, accepted PRs #49/#50 and the preserved RC must remain intact.
