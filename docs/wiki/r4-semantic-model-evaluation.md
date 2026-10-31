# R4 semantic model evaluation — follow-up to independently accepted PR #49

**Status:** draft evaluation implementation, not independently accepted.
**Accepted infrastructure parent:** `c3adec0a06602cab8a9f28abc9690118dc950a3f`, tree `dc887848b9f390a2d8dd4d7a4267e2eea679f35a`.
**Not part of:** the unpublished `0.17.5-rc.1` candidate.

## Why this is a separate branch

The independent verifier **ACCEPTED** PR #49's read-only infrastructure boundary: 67/67 adversarial probes, 934/934 full Bun tests, 67/67 evaluations, 4/4 stress and package parity. No LLM was called and no auto-promotion was accepted. The one nonblocking capacity caveat was that the detached-descriptor budget rejected an otherwise valid 12-proposition response (effective maximum: 11). That correction is isolated on this follow-up branch; do not revise the accepted parent SHA.

## Implementation

- `src/semantic-assessment.ts` descriptor budget now admits **12** independent seven-field propositions (4 envelope fields + 13 array descriptors + 84 proposition fields). Thirteen still abstain. Read-only, source-bound validation and `canApply:false` remain unchanged.
- `scripts/r4-pi-semantic-worker.ts` is an **explicitly invoked** Pi SDK semantic worker, not a production extension hook. It selects a named Pi model, uses a dedicated ephemeral auth runtime, an in-memory session and settings, disables **all tools**, extensions, skills, prompts, themes and context files, and disposes of the session. It outputs only model JSON; exceptions are sanitized.
- The existing `commandSemanticAdapter` is the outer hard-deadline, hard-kill boundary. In-process Pi SDK cancellation is **not** by itself a security boundary.
- `test/unit/r4-semantic-worker-contract.test.ts` covers missing configuration and sanitized failure without a real provider request. Actual SDK resource-disable behavior must be independently witnessed on the exact installed host version before any private user transcript is evaluated.

## Pi 1.4.0 model catalog compatibility

An independent local verification of the initial PR #50 implementation rejected it: `@earendil-works/pi-ai` no longer exports `getModel` from its root. The legacy helper exists under `@earendil-works/pi-ai/compat`, but the updated worker instead resolves `modelRuntime.getModel(provider, modelId)` **after** configuring the dedicated runtime key. This keeps catalog lookup and session inference on one isolated `ModelRuntime`, without relying on the temporary compatibility entrypoint.

**New acceptance gate:** install the actual Pi 1.4.0 SDK peers in an isolated fixture and exercise the *unmodified* worker end-to-end using a known model catalog entry, a dedicated synthetic key and a loopback/mock model response. Verify that it reaches session creation, has zero active tools/discovered resources, produces a JSON semantic proposal, and leaves no Pi store writes. This is not satisfied by a separate diagnostic harness that reconstructs a similar session. If an API mismatch remains, REJECT with the exact failing call.

## Aborted-stream completion gate (2026-10-31)

An independent real-SDK verifier **REJECTED** the earlier worker at `da615a2f689a7280f041e917cb3b44222ad30546` (tree `bfd4930f1abbdcfe2913291faa129872cdaf06d2`): a mock endpoint emitted complete JSON but held the stream open until the worker's 15-second SDK abort. Pi finalized the buffered assistant text with `stopReason: "aborted"`; the old worker incorrectly emitted it and exited 0. SDK model lookup, in-memory isolation and loopback inference already passed on that SHA.

The worker now **requires a successful final assistant `stopReason: "stop"`, no SDK error, non-streaming state, and a deadline latch that was never triggered** before parsing/emitting JSON. An aborted/error/length-limited/deferred/pending assistant turn must fail with sanitized stderr and nonzero exit, even if its text is valid JSON and `prompt()` resolves normally. The outer command adapter's SIGKILL deadline remains independent.

The independent verifier must exercise the **unmodified worker and full evaluator-to-worker chain** against a synthetic loopback endpoint that emits valid JSON but never finishes the stream. Expected: no JSON on stdout, worker nonzero, evaluator abstains, no PI writes. Separately verify an ordinary finished stream still produces an immutable validated proposal. Unit checks on `src/semantic-completion.ts` are necessary but insufficient.

## Manual opt-in model experiment

Run only in a trusted/sandboxed machine with the supported Pi SDK peers installed, and **only** a privacy-reviewed synthetic/labelled corpus. The worker inherits normal OS permissions. Prefer a separate sandboxed user or container without access to live PI stores. Environment variables set by the operator:

```bash
export PI_R4_PI_PROVIDER="<explicit provider>"
export PI_R4_PI_MODEL="<explicit model ID>"
export PI_R4_PI_API_KEY="<dedicated short-lived evaluation credential>"
export PI_R4_MODEL_BIN="bun"
export PI_R4_MODEL_ARGS='["scripts/r4-pi-semantic-worker.ts"]'
bun scripts/r4-semantic-evaluate.ts /path/to/privacy-reviewed-labelled.jsonl
```

The evaluator returns aggregate label confusion and abstention; **it cannot apply memory patches**. Avoid shell command tracing and never commit keys or original private source. The external adapter's 20-second deadline bounds the subprocess, not the provider's billing or remote request completion.

### Holdout design

Compare the same adjudicated labelled examples across (A) deterministic baseline, (B) primary Pi agent, (C) dedicated Pi tool-less model and, later, (D) optional Jev/Laya typed decision models. Separate the fixed 70-case private set, 42-case independent comparison and a *new* frozen untouched holdout. Measure unsafe durable predictions, missed durable interpretations, abstentions, exact source-span fidelity, scope/duration/endorsement accuracy, cost and latency. Model confidence must never authorize memory writes. Treat unverifiable source provenance or incomplete context as review-only.

### Independent acceptance

1. Exact head/tree/ancestry, Bun 1.3.13, frozen install and standard release audit.
2. Source descriptor 12/13 boundary and all 67 existing adversarial infrastructure cases, no write privileges.
3. SDK tool-less and no-resource discovery in an installed-host smoke test. No live project extensions, skills or memory hooks loaded.
4. Synthetic/no-provider failure path, no raw prompt in stdout/stderr error, hard deadline and OS sandbox qualification.
5. Model accuracy is **not** accepted unless a real model is invoked on independently labelled cases and independently scored.

## Other pending work

Do not merge or publish the preserved `0.17.5-rc.1` without operator signoff. Keep source-aware live promotion OFF. Historical inbox reconciliation, TUI, retrieval reliability and GitHub Actions billing remediation remain separate, tracked in issues #45, #46 and #44. The decision-model alternative is preserved in `docs/wiki/r4-semantic-assessment-decision.md`.
