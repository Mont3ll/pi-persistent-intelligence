# Manual release procedure

PI can be released without GitHub Actions when the repository's hosted runner is unavailable. The verification commands do not depend on GitHub Actions. Every manual release still needs a recorded test result, an exact commit, a package check and a separate decision to publish.

GitHub Actions is currently unable to start jobs because of an account billing restriction ([issue #44](https://github.com/Mont3ll/pi-persistent-intelligence/issues/44)). Its red checks are infrastructure failures: no test runner was assigned and no test failed in those jobs. Keep the workflows in place for when the account restriction is lifted. A pending or failed hosted check is not, by itself, a veto on the manual process below. Do not describe such a check as green.

## What is being prepared

The current source candidate is `0.17.5-rc.1`. Its base is the verified R0–R3a merge at `3104209c1f4792d338bd95b982844b1011cda1d3`. The candidate has not been published or deployed.

The last preserved-store acceptance used 519 unique canonical records and 53 pending candidates. The live store later gained another candidate through normal capture activity while verification was running. Counts can change while Pi is active, so use actual values from the quiesced backup at release time. Do not reset or silently absorb the inbox to match an earlier report.

Source-aware automatic transcript retry remains disabled by default. The release does not change that setting. Existing `autoCurate: high-only` configurations are separate from the source-aware opt-in; inspect the effective configuration before any migration or smoke test.

## Verification record

Use a clean checkout of the exact candidate commit with Bun 1.3.13. Record its full commit and tree IDs before running tests. The local verifier must run the commands; a report from an earlier commit does not certify a version bump.

```bash
git status --short
git rev-parse HEAD
git rev-parse HEAD^{tree}
bun --version
bun install --frozen-lockfile
bun run release-audit
bun scripts/publish-guard.ts verify-tag v0.17.5-rc.1
npm pack --dry-run
```

`release-audit` runs type checking, the full unit suite, deterministic evals, stress tests and a package dry run. Record counts, exit codes and any warnings. On the isolated candidate, check that `package.json`, the governance export producer version, the changelog and the intended tag agree. Inspect the actual package tarball and verify that its entry point imports in a disposable environment with the supported Pi host peers.

Run the important memory flows against a *copy* of the store: inbox review, held-source retry, source proof at both curation and apply, FTS recall, selection-bound receipt replay, crash recovery and privacy-purge redaction. Never exercise destructive acceptance cases on the user's live memory root.

A release record should include the candidate SHA and tree, Bun version, relevant dependency versions, command outputs, packed file inventory, backup fingerprint and the operator's approval. Note `GitHub-hosted verification: unavailable (billing restriction)` if the runner remains locked. The independently witnessed local checks are the evidence used for this manual path.

## Keeping the live store safe

A frozen snapshot remains consistent as captured, but the live store can change while Pi is running. In the earlier acceptance, the preserved copy stayed byte-identical while the original inbox grew from 53 to 54 pending candidates. Quiesce live writers before taking the release backup and checking preservation, then record its current generation, candidate count and file hashes.

Before installing any candidate on the host:

1. Stop or quiesce active Pi sessions, capture hooks, background writers and any application using the store. Confirm that no governance transaction is unresolved.
2. Save the current runtime package, effective configuration, full store tree and a file inventory with hashes. Include SQLite databases and their WAL/SHM companions if present. Use a database-consistent backup or keep all writers stopped.
3. Confirm the backup can be read, canonical generation and inbox counts agree, and the copied SQLite databases pass an integrity check. Keep the backup separate from the runtime being upgraded.
4. Install the exact approved package in a staging location. Confirm the installed version and package contents before switching the host to it.
5. Start with the existing production policy, source-aware promotion OFF. Check canonical counts, inbox state, retrieval, index catch-up and transaction recovery. Stop on unexpected writes, source-proof failures, privacy leaks or an agreed latency limit breach.

Preserve any new captures made during the change window. If the store moves forward, do not restore an old runtime against unresolved new-format transactions or overwrite newly captured data to force a rollback.

## Publication is an explicit operator action

These are commands for the person performing the release, **not** instructions for an automated agent to run without authorization.

For a release candidate, after exact-SHA verification and operator approval:

```bash
npm view pi-persistent-intelligence@0.17.5-rc.1 version
npm publish --tag next --access public
npm view pi-persistent-intelligence@0.17.5-rc.1 version
```

If the preflight `npm view` finds the version already published, inspect it instead of publishing over it. Treat authentication, network and registry errors as failures. `npm publish` also invokes the repository's `prepublishOnly` verification. Do not pass `--provenance` for a manual publish unless the publishing environment actually supports valid npm provenance.

Publish stable `0.17.5` only after acceptance of the release candidate and a separately verified stable-version commit. A prerelease stays under the `next` dist-tag and must not be made `latest` by accident.

The repository's `.github/workflows/publish.yml` runs on tags matching `v*` and attempts publication to npm and GitHub Packages. With billing restored, pushing such a tag can trigger automated publication. Check the workflow's status and decide which publisher is responsible before pushing a release tag. Avoid duplicate publishers and mismatched package names. A manual npm release does not automatically publish a GitHub Packages copy.

## Rollback and reconciliation

Stop writers first. Keep post-upgrade changes for inspection, and restore a matching pre-upgrade runtime, store and configuration backup. Confirm canonical generation, pending candidates and SQLite integrity before allowing new writes.

If the new runtime has already written valid new-format transactions or captured additional user instructions, reconcile those deltas explicitly. A blind file copy can lose them. If snapshot commitments or historical privacy manifests are corrupt, hold recovery and investigate; the application does not promise automatic rollback after canonical publication.

## Release decision

A candidate can be approved for a manual npm release when the exact candidate passes local `release-audit`, packaging and isolated-store acceptance, with a written sign-off that records the hosted runner limitation and residual risks. Host deployment requires its own quiesced backup and staged smoke tests. Enabling source-aware auto-curation requires separate authorization after deployment.

See [Contributing](contributing.md) for the day-to-day test commands and [Changelog](../../CHANGELOG.md) for the changes in this candidate.
