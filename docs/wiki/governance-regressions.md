# Governance Regressions

This log records governance regressions PI is designed to prevent. It is a public contributor guardrail, not a private sprint diary.

## Regression: Automatic L1 promotion

- Risk: A broad identity or operating principle becomes durable without explicit human ratification.
- Example failure: Meta-consolidation writes directly to `L1.identity.jsonl`.
- Guard: L1 candidates are review-only and never auto-applied.
- Tests/evals: meta-consolidation safety, strict governance, patch-boundary tests.
- Related files: `src/meta-consolidation.ts`, `src/curator.ts`, `src/patch.ts`.

## Regression: Contested memory injected as hard truth

- Risk: Disputed guidance appears under Hard Rules and overrides the user.
- Example failure: A contested high-confidence correction is selected by hard-rule extraction.
- Guard: Contested memory is warning-only and never under Hard Rules.
- Tests/evals: contested-memory tests, Recall X-ray hard-rule tests.
- Related files: `src/rules.ts`, `src/contested-memory.ts`, `src/recall-xray.ts`.

## Regression: Codebase text treated as durable authority

- Risk: Repository or tool output bypasses user review and becomes a preference.
- Example failure: Passing `tsc` evidence auto-applies a durable workflow rule.
- Guard: Codebase-analysis is supporting evidence, not automatic truth.
- Tests/evals: codebase-evidence tests, evidence-link no-bypass eval.
- Related files: `src/evidence.ts`, `src/evidence-link.ts`, `src/verifier.ts`.

## Regression: Background job directly mutates memory

- Risk: Scheduled/local reports change durable memory outside patch review.
- Example failure: Background meta-consolidation writes L1 directly.
- Guard: Background jobs produce reports or review candidates only.
- Tests/evals: background-analysis tests and hard invariant evals.
- Related files: `src/background-analysis.ts`.

## Regression: Procedure candidate auto-writes skill files

- Risk: PI writes executable/behavioral instructions without human review.
- Example failure: `/memory-skill draft` writes `skills/foo/SKILL.md` automatically.
- Guard: Skill writing is review-gated and never automatic; draft artifacts live under reports.
- Tests/evals: procedure export boundary and skill draft tests.
- Related files: `src/procedure-candidates.ts`, `src/skill-draft.ts`.

## Regression: Private report packaged or committed as public docs

- Risk: Sprint reports, local audits, or private operational notes appear as public package docs.
- Example failure: `docs/PI-SPRINT-*.md` ships in npm package.
- Guard: Package allowlist includes only public docs; docs-contract tests keep docs root public-only.
- Tests/evals: docs-contract package-files tests.
- Related files: `package.json`, `.gitignore`, `test/docs/docs-contract.test.ts`.
