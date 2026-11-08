# R4 guarded automatic semantic L2 promotion — implementation and acceptance

**Status:** Development draft; independent testing pending. **Do not merge, publish, deploy or enable on the live store.**

## Accepted parents

- PR #49: proposal-only LLM infrastructure, `c3adec0a06602cab8a9f28abc9690118dc950a3f`.
- PR #50: tool-less Pi 1.4 model worker/completion safety, `58a1a443964943721739be27ddbd44ad47cbba2a`.
- PR #51: original-source-proven, supervised atomic proposition capture and L2, `39657092515a270fc009d5acd97a30c501de7a20`, tree `44d107d8ff5979073ee02eca05490b9d4c8a7f54`, independently ACCEPTED (128/128 adversarial; full 977/977, eval 67, stress 4, SDK smoke).

The next release must demonstrate working automatic retention and subsequent-session recall; passing this isolated source branch does **not** authorize a release.

## Architecture of this branch

1. `curator.semanticAuto`: `off` by default. Experimental `guarded-project` enables only a single directly endorsed, standing, project-scoped L2 proposition. In semantic mode, generic legacy bulk auto-curation at shutdown is skipped; normal v1 review is still available.
2. `src/semantic-host-capture.ts`: obtains the original user-entry ID and **exact persisted text** from the Pi SessionManager, not a fabricated timestamp/array index. Repeated identical text without unambiguous entry association abstains. Real worker invocation requires explicit executable/args, provider, model, dedicated API key and `PI_R4_DATA_TRANSMISSION_APPROVED=yes`. No default external model calls.
3. `src/semantic-auto-promote.ts`: validates the first model assessment and materializes a v2 candidate. Fresh original-turn proof must pass, the normal supervised curator must produce exactly one low-risk L2 `add`, then a **second** source-bound assessment must match before automatic apply. A second assessment is not independent semantic truth or a substitute for accuracy evaluation.
4. `src/semantic-auto-permit.ts`: issues an ephemeral WeakMap-backed permit bound to exact candidate, original session/turn/hash/project and serialized operation. It is **not** stored in candidate, evidence, patch, receipt, or model output. A forged JSON field or selection flag cannot instantiate the permit.
5. `src/patch.ts` and `src/patch-direct.ts`: carry the transient permit into a guarded transaction. The prior default review-only block remains unless configuration, operation, selected subset, confidence, risk, permit, exact original proposal snapshot and **fresh trusted transcript proof** all agree. Under-floor references may be considered only through this vetted semantic path. L1 and supersede operations remain ineligible.
6. `src/lifecycle.ts`: an opt-in agentEnd route assesses authentic Pi persisted user entries. With no approved model/entry, it falls back to existing inbox capture, not semantic auto. Under semantic mode generic v1 shutdown auto-curation is suppressed. Successful governed writes sync retrieval indexes.

### What the branch does not establish

- No real provider inference, accuracy on independently labelled R4 corpus or known safe model choice.
- No OS/process sandbox guarantee. The worker retains process permissions; model selection, explicit privacy and spend authorization remain mandatory.
- No admission of global, time-bounded, multi-proposition, quoted/reported, contradictory or unknown-scope instructions.
- No next-session retry of a model-assessed candidate if the original Pi transcript was not yet flushed; pending candidates remain review-only. Source-aware v1 retries do not become semantic permits.
- No historical backlog auto-reconciliation or live-store writes.
- No claim of general zero-false-positive performance from deterministic fixtures.

## Independent verifier R1: REJECT — conflict and proposal-generation authority (2026-11-08)

At original PR #52 HEAD `a35371b20005dad9041f898f6b093c44cdb7d5b3`, independently reconstructed tree `61df3979b6d430deda38700f8fddf675b2d9145c`, engineering and **the genuine installed SDK happy path passed**, including an actual automatic L2 write, duplicate prevention and next-session recall. But independent verifier **REJECTED** automatic authority: 32/38 new expected outcomes passed, with two distinct defects reproduced as real governed writes:

1. Existing same-key conflicting/ambiguous owner rules caused the genuine curator to say manual merge/review (and verification review hold), but `src/semantic-auto-promote.ts` promoted any low-risk `add` anyway. One opposed rule returned `strengthens_existing`; that also requires review rather than another automatic record.
2. While awaiting the second model assessment, an independent governed owner transaction advanced canonical generation. The coordinator sampled the newer generation **after** the await and applied the old proposal, including against an opposed rule. The lock correctly rejected a deliberately stale `expectedGeneration`; the coordinator failed to preserve the proposal generation.

Previous evidence: `PI_R4_PR52_GUARDED_AUTO_PROMOTION_VERIFICATION.md`. All 322 accepted-parent independent controls, 991 full Bun, 67 eval, 4 stress, typecheck/release audit and 177-file parity passed on the **rejected old SHA**, not the correction.

### New correction to verify independently

- `src/semantic-auto-current-state.ts` recomputes canonical match and deterministic verification **against currently active records**, without relying on stored `normalized_key`, `match_kind`, curator prose or low risk. Only a genuinely new project rule with a supported and verified candidate can enter automatic L2; duplicate, strengthens, updates, opposed, supersession, ambiguity and verification-review states hold.
- `src/semantic-auto-promote.ts` captures `proposalGeneration` **before** curator proposal and asynchronous second model assessment; an intervening owner write invalidates the pending automatic proposal, including unrelated writes. It supplies the original generation to `applyPatch` rather than replacing it with a later reading.
- `src/semantic-auto-permit.ts` binds the short-lived capability to that exact proposal generation. `src/patch.ts` carries the writer-lock-validated expected generation into `src/patch-direct.ts`, whose workspace intentionally has no generation ledger. Apply independently rechecks current match and verification, then requires permit generation agreement. An owner update cannot be made legitimate by changing `expectedGeneration` at the caller.
- `test/unit/r4-semantic-conflict-fence.test.ts` creates **actual manually governed owner L2 writes** using real curator-derived record schemas and identity keys. It tests two conflicting owner records with explicit `ambiguous` rationale, one opposed rule, both an unrelated and an opposed write at the second-assessment await boundary, invalidation of an already issued permit, automatic promotion at generation 1 when an unrelated rule existed **before** curation, and the clean positive path.

The verification must show a **genuine automatic happy-path write and next-session recall** while no new automatic governed L2 write occurs in the conflict/race controls. The old 322/322 parent controls and SDK 5/5 must remain passing. All edits on this corrected HEAD are **UNVERIFIED**; do not present old-run passing tests as new-run evidence.

## Run in an isolated store only

A fixture can write `curator.semanticAuto = "guarded-project"` and inject a deterministic `SemanticAdapter` into `promoteSemanticTurnAutomatically`. This tests real source → assessment → candidate → independent proof → curator → transient permit → governed L2 → next-session recall, without external inference or live paths.

The host adapter additionally requires explicit transmission permission and these environment variables:

```
PI_R4_MODEL_BIN=<trusted absolute executable>
PI_R4_MODEL_ARGS=<JSON array of literal arguments>
PI_R4_PI_PROVIDER=<approved provider>
PI_R4_PI_MODEL=<approved model>
PI_R4_PI_API_KEY=<dedicated short-lived evaluation credential>
PI_R4_DATA_TRANSMISSION_APPROVED=yes
```

**Do not configure these on a live PI session until the actual model, data transmission, spend cap, OS isolation and benchmark results are explicitly approved.** Feature remains OFF by default.

## Independent local acceptance gates

1. Exact new HEAD/tree, clean worktree, accepted #51 ancestry; install frozen Bun 1.3.13 / SDK 1.4.0; typecheck and release audit.
2. Positive: a genuine source-v3 Pi session entry containing an instruction beyond offset 300 creates one v2 source-grounded candidate and **automatically** applies exactly one governed L2 add, with real transaction receipt and generation increment. A later session must retrieve that exact L2 fact. Duplicate execution/replay must create zero new canonical writes/evidence.
3. Negative: feature OFF performs no model call; unavailable approval/credentials does not transmit; missing/stale/mismatched source, spoofed IDs, quoted/reported/bounded/uncertain/global/mixed context, second-pass disagreement, source/evidence/patch tampering, forged `default_selected`, fake permit objects, stale canonical generation, conflicts, high risk or supersede all fail closed.
4. Verify the **actual** Pi lifecycle integration using isolated SDK 1.4.0 with multiple turns, same-text duplicates, local session-manager v3 IDs and a deterministic injected/loopback assessor (no paid or private model inference). Report failures when the session entry is unflushed, not merely static source assertions.
5. Re-run all accepted #49/#50/#51 integrity controls and 67 evaluations/4 stress/full unit/docs/package parity/smoke. Never claim semantic-model accuracy solely from synthetic assessments.
6. Preserve live gen25/NEW82 reported at last checkpoint, R4a private corpus, accepted #49/#50/#51 trees, rejected #47/#48 and RC. **Separate damaged-worktree finding:** PR #47 and RC working copies each have 446 physically missing tracked files; leave untouched for forensic preservation. No destructive repair.

## Release milestones still blocking

Select and authorize actual model/provider/data transmission/spend, run the adjudicated R4 negative and durable holdout, qualify OS isolation, verify product-level precision and recall/false-hold metrics, assess next-session flush/retry and backlog resolution, and perform a genuine isolated SDK TUI/retrieval/recovery campaign. Only then prepare a new release candidate. This branch is deliberately a development checkpoint, not a release.
