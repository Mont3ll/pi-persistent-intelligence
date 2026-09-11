# PI Governance Maturity Program

Date: 2026-09-11
Status: Design for review
Repository: `Mont3ll/pi-persistent-intelligence`

## 1. Purpose

This document defines the implementation and verification program for taking PI from the current v0.16.0 state through correctness hardening and into the next governance-kernel stage.

The immediate objective is not feature expansion. It is to make existing governance claims mechanically true, restore or complete broken lifecycle behavior, establish reproducible verification, and create a disciplined path toward stronger transactional, temporal, privacy, and policy guarantees.

The LLM Wiki repository is intentionally out of scope for implementation until the PI program described here reaches its defined handoff gate.

## 2. Operating model

Development uses two deliberately asymmetric agents.

### Web agent

The web agent owns judgment and authorship:

- repository and history inspection
- architecture and product decisions
- defect prioritization
- test design
- implementation
- PR creation and updates
- failure interpretation
- migration and compatibility reasoning
- release-readiness recommendation

### Local verifier agent

The local verifier is an operational executor rather than a co-author. It:

- checks out an exact commit SHA
- records toolchain and environment versions
- runs supplied baseline and candidate commands
- executes focused regression tests
- executes repository and release verification suites
- performs prescribed fault-injection scenarios
- returns structured evidence

It must not independently modify the branch under verification. If it identifies a possible fix, it reports evidence and the web agent decides and implements.

This separation is intentional. Verification should remain independent from authorship.

## 3. Verification identity

The commit SHA is the unit of verification.

Every handoff must identify:

- repository
- PR number when available
- base SHA
- head SHA
- verification protocol version
- required commands
- focused checks
- expected invariants
- known baseline failures, if any

A verification result is valid only for the exact tested head SHA. Any new commit invalidates prior verification.

Merge readiness requires:

`PR HEAD == locally verified SHA == CI verified SHA`

## 4. Handoff contract

The handoff format should be structured and versioned. A representative contract is:

```yaml
handoff_version: 1
repository: Mont3ll/pi-persistent-intelligence
pr: 0
base_sha: <sha>
head_sha: <sha>
verification_level: V1 | V2 | V3
objective: <short statement>

changed_areas:
  - <path or subsystem>

required_checks:
  - command: bun test
    expected_exit: 0

focused_checks:
  - command: bun test <focused-test>
    expected_exit: 0

invariants:
  - <observable invariant>

known_baseline_failures: []

retry_policy:
  max_retries: 0
  retryable_conditions:
    - timeout
    - network-only setup failure
```

The verifier should return:

```text
VERDICT: PASS | FAIL | BLOCKED
TESTED_SHA: <sha>
BASE_SHA: <sha>
PROTOCOL: <version>
BUN: <version>
OS: <environment>

CHECKS:
- <command>: PASS | FAIL | BLOCKED

FIRST_FAILURE:
<useful stdout/stderr excerpt>

INVARIANTS:
- <invariant>: PASS | FAIL | NOT_EVALUATED
```

Functional failures are evidence, not an invitation for the verifier to patch code.

## 5. Baseline discipline

Every correction PR must distinguish existing failures from introduced failures.

The verifier runs the same relevant checks against the specified base SHA and head SHA when baseline state is not already trusted.

Interpretation:

| Base | Head | Meaning |
| --- | --- | --- |
| Pass | Pass | candidate is clean for that check |
| Pass | Fail | candidate regression |
| Fail | Pass | candidate repairs baseline |
| Fail | Fail | compare signatures before attribution |

This is especially important while the visible v0.16.0 CI baseline is unresolved.

## 6. Verification levels

### V1: focused iteration

Used during active implementation.

Typical scope:

- focused regression tests
- relevant typecheck
- narrowly targeted invariant checks

### V2: repository readiness

Required before a PR is considered ready.

Typical scope:

- full unit suite
- repository typecheck
- deterministic eval suite
- lint and documentation checks where applicable

### V3: release readiness

Required before publishing a version.

Includes V2 plus:

- stress and fault-injection tests
- clean install verification
- package dry run
- migration and upgrade tests
- reproducibility checks
- selected protocol or benchmark contract checks where appropriate

Paid or long-running external benchmark suites are milestone evidence, not per-PR checks.

## 7. Program phases

### Phase A: v0.16.x Governance Correctness

Goal: make existing behavior internally coherent before introducing new architecture.

No new retrieval algorithms, memory categories, user-facing feature families, or shared Wiki abstractions should be introduced in this phase.

#### PI-H1: Verification baseline and CI reproducibility

Objectives:

- reproduce current CI failure from the v0.16.0 base
- identify and fix the actual failing condition
- align local, PR CI, and release verification commands
- pin the Bun/toolchain version rather than relying on `latest`
- ensure the release gate executes the intended release audit rather than a narrower approximation

Acceptance gate:

- clean checkout can reproduce verification
- main-equivalent baseline is explainable
- CI and documented local commands agree
- release command can be executed by the local verifier without interpretation

#### PI-H2: Patch lifecycle completeness

Objectives:

- implement the declared `reject_candidate` patch operation
- add focused tests that fail without that behavior
- restore complete supersession metadata, including temporal invalidation fields
- normalize supersession risk classification and documentation
- verify idempotent or explicitly rejected reapplication behavior where applicable

Acceptance gate:

- every declared patch operation has an executable path or is explicitly rejected before application
- candidate rejection is durable
- supersession records current and historical state consistently
- focused lifecycle suite passes on exact head SHA

#### PI-H3: Derived-state integrity

Objectives:

- make FTS rebuild transactionally safe at the SQLite layer
- stop silently presenting inactive historical memory as current long-term state
- define current, contested, and historical projection semantics
- add regression tests for stale or failed derived-state rebuild behavior

Target projection semantics:

- current view: active memory only
- contested view: contested items with warning semantics
- history view: deprecated, superseded, deleted, and other non-current lifecycle states

Acceptance gate:

- failed index rebuild does not leave a partially rebuilt index presented as healthy
- superseded or deprecated state cannot appear as current truth
- derived views can be deterministically rebuilt from canonical state

#### PI-H4: Historical hardening archaeology

The branch `audit/0.12-performance-governance` must not be merged wholesale.

Each change should be classified as:

- already superseded
- already reimplemented
- still missing
- no longer applicable
- unsafe to restore

For every still-missing useful change:

1. write or restore a regression test against current architecture
2. implement the smallest current-main correction
3. verify independently

Once all useful knowledge is accounted for, the historical branch should no longer serve as an informal backlog.

#### PI-H5: Privacy and mutation boundary hardening

Objectives, subject to focused re-audit after H1-H4:

- disable or minimize persisted prompt excerpts by default
- define configurable retention for diagnostic text
- verify privacy purge reaches correlated derivative artifacts
- account for recall, reinforcement, inquiry, diagnostic, and export derivatives
- narrow or internalize unsafe mutation entry points exposed through source/deep imports

Acceptance gate:

- privacy deletion has a mechanically testable derivative-accounting story
- ordinary callers cannot bypass the intended mutation gateway without explicitly using internal/test-only interfaces

### Phase B: v0.17 Governance Kernel

Entry requirements:

- CI is green and reproducible
- all historical hardening changes have been classified
- patch operation semantics are complete
- temporal supersession is coherent
- current/history projections are explicit
- privacy regression tests pass
- release verification is trustworthy

This phase introduces architectural primitives in separate slices rather than one large refactor.

#### 0.17-K1: Revisioned canonical state

Introduce a monotonic canonical generation or revision identity.

Every derived view should identify the canonical generation from which it was produced.

#### 0.17-K2: Governance transaction envelope

Create a single mutation transaction path conceptually following:

1. validate
2. acquire writer lock or generation precondition
3. evaluate preconditions
4. stage mutation set
5. write commit intent
6. fsync durable state
7. publish new canonical generation
8. derive projections
9. mark transaction complete

The existing privacy-artifact staging pattern should inform this design.

#### 0.17-K3: Crash recovery and idempotency

Add deterministic recovery for interrupted mutations and explicit replay semantics.

Required fault scenarios include:

- kill after each transaction stage
- same patch applied twice
- duplicate append attempt
- malformed or truncated JSONL
- disk/write failure
- stale derived index
- interrupted projection rebuild

#### 0.17-K4: Concurrent writer safety

Introduce explicit writer coordination and precondition checking so simultaneous processes cannot silently lose state.

#### 0.17-K5: Evidence, Belief, Policy separation

PI should make authority explicit.

Evidence plane:

- source observations
- user utterances
- tool outcomes
- tests and commits

Belief plane:

- preferences
- claims
- conventions
- experiences
- learned procedures

Policy plane:

- ratified directives
- hard prohibitions
- operating rules
- identity or capability constraints

Core invariant:

> Confidence alone must never promote belief into policy.

Policy authority must include explicit provenance and ratification rules.

#### 0.17-K6: Strict governance defaults for new stores

New stores should default to strict trust/governance semantics. Compatibility behavior should remain available only as a migration path for existing stores.

## 8. Later PI maturity stages

These are intentionally blocked until Phase A and Phase B are proven.

### v0.18 Retrieval Intelligence

Candidate work:

- entity-assisted retrieval
- stable entity aliases
- temporal query semantics
- evidence or episode retrieval
- deterministic audit retrieval mode
- query planning modes
- optional graph expansion
- richer ranking without weakening provenance

Evaluation must include not only answer recall, but also:

- scope precision
- temporal correctness
- stale-memory influence
- poisoning reachability
- false-directive rate
- abstention quality
- latency and context cost

### v0.19 Governance interoperability

Only after PI's primitives have been proven should PI and the LLM Wiki be examined for implementation-level shared governance contracts.

The repositories should continue to retain different truth models.

Potential shared primitives may eventually include:

- SourceIdentity
- EvidencePointer
- Actor
- Candidate lifecycle
- Decision
- Revision
- Transaction envelope
- TemporalValidity
- AuditEvent
- Projection metadata

Semantic similarity is not sufficient reason to extract a shared package. Shared code is justified only where the semantics are demonstrably identical.

## 9. PR discipline

Each implementation PR should state:

1. problem
2. violated invariant
3. root cause
4. change
5. regression test
6. compatibility impact
7. migration impact
8. privacy impact
9. verification commands
10. verified head SHA
11. local-verifier result
12. CI result

PRs should remain narrowly attributable. Feature expansion should not be mixed into hardening PRs.

## 10. Test authorship

The web agent writes or specifies the proof obligation before implementing a correction.

Preferred loop:

1. encode the failure or invariant as a test
2. demonstrate that it fails against the relevant baseline when feasible
3. implement the minimum correction
4. run focused checks
5. push immutable head SHA
6. hand the SHA and commands to the local verifier
7. interpret returned evidence
8. patch only through the web-agent branch
9. issue a new SHA and repeat verification

The verifier executes tests but does not invent the acceptance criteria for governance behavior.

## 11. Fault-injection role of the local verifier

As PI moves into v0.17, the local verifier becomes the primary executor for repetitive operational scenarios such as:

- process termination at transaction boundaries
- concurrent writers
- corrupted derivative indexes
- stale canonical-generation markers
- repeated patch application
- interrupted recovery
- malformed canonical data

The web agent defines each scenario and expected invariant. The local verifier returns evidence without choosing repairs.

## 12. Release gates

### v0.16.x exit gate

All must hold:

- repository CI green
- reproducible verification commands
- patch language complete for declared operations
- temporal supersession coherent
- FTS rebuild protected against partial SQLite rebuild
- current versus historical memory projection explicit
- historical hardening branch fully accounted for
- scoped privacy/mutation-boundary issues resolved or explicitly deferred with tests

### v0.17 exit gate

All must hold:

- canonical generation/revision exists
- mutation transaction has deterministic recovery
- concurrent writers cannot silently overwrite state
- replay/idempotency semantics are explicit
- derived views expose freshness against canonical state
- evidence, belief, and policy authority are separated
- strict defaults apply to new stores
- V3 fault suite passes on release candidate

### 1.0 direction

PI 1.0 should be defined by invariants rather than feature count.

Candidate 1.0 invariants include:

- no durable belief bypasses governance
- no directive policy is created from confidence alone
- rejected candidates stay rejected unless explicitly reconsidered
- failed mutation cannot silently partially commit
- concurrent writers cannot silently lose canonical state
- all materialized views identify their canonical generation
- superseded state is not presented as current truth
- historical queries preserve historical validity
- contested state cannot become hard policy
- privacy purge reaches derivative artifacts
- untrusted repository text cannot silently become directive memory
- canonical state survives derived-index corruption
- releases are reproducibly verified

## 13. Deferred LLM Wiki handoff

No LLM Wiki implementation should begin during the PI correctness program.

The Wiki becomes active after PI has a stable, tested governance-kernel baseline. At that point the Wiki will be audited independently against its own epistemic invariants, then compared with PI for genuinely shared governance primitives.

This sequencing prevents premature abstraction and gives the Wiki a proven governance implementation to learn from without forcing it into PI's operational-memory semantics.

## 14. Immediate implementation sequence after approval

1. establish PI-H1 baseline at v0.16.0 head
2. reproduce and explain current CI failure
3. make verification commands reproducible and toolchain-pinned
4. complete PI-H1 PR and verify exact SHA
5. implement PI-H2 lifecycle regressions using tests first
6. complete PI-H3 derived-state integrity
7. perform PI-H4 branch archaeology
8. perform focused PI-H5 privacy/mutation audit
9. cut the v0.16.x governance-correctness release only after the release gate passes
10. begin v0.17 architectural slices
