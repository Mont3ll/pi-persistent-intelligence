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
