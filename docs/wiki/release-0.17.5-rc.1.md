# 0.17.5-rc.1 release notes

**Status: candidate source, not published.** These notes describe R0–R3a, merged into `main` at `3104209c1f4792d338bd95b982844b1011cda1d3`. The RC version change and this release document still need independent verification at their own exact commit before an npm publish is considered.

The currently installed runtime and published npm package are `0.17.4`.

## What changed

Memory capture now has stronger attribution to the user turn and session that produced it. A candidate with a single source can qualify for automatic curation only when the source-aware mode has been explicitly enabled and the original Pi transcript is successfully checked. The apply transaction checks the transcript again before writing canonical memory. Source-aware mode stays OFF by default.

When a previous session ended before its transcript was available, the next primary session can retry held attributable candidates under that opt-in policy. The retry applies no more than three governed operations per start. Inbox discovery and curation can still examine the full pending set, and the retry is conservatively excluded from non-TTY and child-agent runs.

The inbox browser now shows why candidates are held for evidence, policy or review. These explanations are preflight guidance; the actual curator and transaction decide whether a memory can be applied. Matching and release-scoped recall also received fixes.

Transaction receipts now identify the selected operation subset. Replaying the same authorized request stays idempotent; changing a selection cannot inherit the earlier receipt. Older completed receipts are accepted only when their selection can be established from complete, unambiguous evidence. Selection-specific receipt archives preserve both operations when the same proposal is applied in parts.

Privacy purges now redact correlated historical governance transaction results and stored receipts. Replaying an old caller-held patch cannot write the purged payload back into latest-view files. Recovery checks complete historical snapshot inventories, rejects unexpected filesystem artifacts and compares SHA-256 commitments for the original and redacted snapshot bytes against the durable intent. Corruption or reversion produces a hold. There is no automatic rollback after canonical publication.

## Source verification already completed

The independent R3a verifier accepted the merged feature parent with **916/916 unit tests**, **67/67 deterministic evaluations**, **4/4 stress tests** and type checking. The installed-SDK scenario applied five genuine user instructions across startups in a 3/2/0 sequence, then recalled the five records in subsequent sessions without duplicates.

A separate integrated check of the merged `main` repeated local `verify:pr` twice. It passed the same unit/eval/stress suites and tested a locally packed artifact. The copied-store rehearsal read 519 unique canonical records, 605 evidence records, 53 pending candidates, 162 patch artifacts and 23 completed governance manifests. The copy contained 1,530 files (92,728,720 bytes), 10,328 parsable JSONL rows and SQLite databases that passed quick-check.

**These results belong to the merged source before the RC version change.** They do not certify the candidate package. The next local verifier must check the RC commit and its tarball again.

GitHub Actions never ran on these commits. Its test job was stopped before a runner started because the GitHub account is locked for billing. The manual release path uses independently witnessed local commands instead of treating that unavailable hosted job as failed source code. [Issue #44](https://github.com/Mont3ll/pi-persistent-intelligence/issues/44) tracks restoring hosted CI.

## Known operational limits

The live store was not quiesced for the integrated rehearsal. While the preserved copy remained byte-identical, the original live inbox grew from 53 to 54 pending candidates through normal capture activity. The next deployment rehearsal must stop capture and writers long enough to obtain a consistent backup and prove live preservation.

Cold startup took roughly 3.1 seconds in the relocated 685-session fixture, largely from session index rebuilding. Warm starts in the copied environment were around 103–113 ms. Those measurements are local samples and are not production latency targets. The three-operation limit caps writes, not the amount of curation work.

Source-aware automatic promotion remains OFF by default. No historical backlog absorption or L1 identity promotion is part of this release. The unkeyed snapshot commitments detect local corruption or accidental reversion. They are not a defense against coordinated modification of the snapshots and the durable manifest, and power-loss durability was not tested.

## Manual release and rollback

Follow [Manual Release](manual-release.md) for the exact-commit verification, package inspection, npm `next` tag, quiesced store backup and staged host smoke test. Stable `0.17.5` requires its own versioned and verified commit after this candidate is accepted.

If the host needs rollback, stop writers and restore a matching runtime, store and configuration set. Preserve post-upgrade captures for reconciliation. Do not start `0.17.4` against unresolved transactions written by a newer runtime.

**Not authorized by this candidate:** npm publication, live installation, historical inbox absorption or source-aware policy enablement.
