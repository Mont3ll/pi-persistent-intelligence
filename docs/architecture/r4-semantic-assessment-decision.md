# ADR: advisory semantic interpretation, deterministic memory authorization

**Proposed 2026-10-30. Pilot only; not yet independently verified.**

## Evidence and decision

R4 independent verification repeatedly found genuine user-source transcripts gaining incorrect durable authority because temporary, quoted and contextual language was misclassified. The last rejected PR #48 showed improvement on 42 unseen cases (unsafe approvals 14→2) but reduced correct automatic approvals (19→13), and increased false review holds (2→8). A new regex exception for each turn of phrase is not a general solution.

PI will **use LLM/agent reasoning to propose what a turn means**, while retaining **deterministic control of what can be written**. Meaning and authority are separate. Source hashes demonstrate origin, not intent. No model score or JSON verdict grants canonical write permission.

## Trust boundaries

1. Trusted Pi transcript supplies authenticated original user turns and verified context. Do not accept model-invented attribution.
2. Semantic assessor proposes atomic statements with exact source spans, endorsement, temporal scope, applicability and uncertainty. Allow explicit abstention.
3. PI validates source span equality, SHA, identity, trust, project and source context, privacy, duplication, tombstones and governance rules independently.
4. Any ambiguous/quoted/conditional/multi-proposition case is review-only until source-grounded interpretation has passed separate adversarial tests.
5. L1 ratification and risky supersession remain human-governed. Model outputs cannot choose patch operations or directly mutate canonical memory.

## Pilot implemented in this branch

- `src/semantic-assessment.ts`: schema, exact source spans, SHA binding, abstention and unconditionally `canApply: false`.
- `src/semantic-assessment-command.ts`: explicit optional LLM command adapter, no shell, timeout and bounded output.
- `test/unit/r4-semantic-assessment.test.ts`: schema/span/authority injection/failure tests.

**No production capture integration or automatic promotion is enabled.** The pilot is read-only and has no model selected by default. An independently verified inference benchmark is required next.

## Jev/Laya decision-model option — retained

Preserve Jev/Laya-style typed decision models as potential *fast classifiers and escalation routers*, particularly for v0.18 retrieval and R4 intake triage. They are not an installed dependency, verified semantic authority or replacement for contextual proposition extraction. Evaluate deterministic baseline, primary Pi agent, focused LLM, typed model and a decision-model→LLM cascade against identical private, adjudicated holdouts. Compare unsafe approvals, correct durable coverage, abstention, scope/proposition fidelity, runtime cost, privacy and latency. A fast model's apparent confidence is not authorization.

## Next gates

- Preserve rejected PR #48; do not merge its regex branch.
- Local verifier: exact HEAD/tree, Bun 1.3.13 frozen install, full test/eval/stress, independent schema/JSON/spoofing/source-span tests, package checks.
- On an isolated snapshot, build an actual model-driven evaluator and compare held-out performance, with **zero new write permissions**.
- Implement integrated original-turn and multi-turn evidence spans only after accepting a model contract; enforce policy again at governed apply.
- Handle backlog reconciliation, real TUI and startup reliability separately.
- Preserved `0.17.5-rc.1` publication and live deployment are explicit release decisions; source-aware auto stays OFF.
