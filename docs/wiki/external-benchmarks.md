# External agent-memory benchmarks

PI includes a repository-only harness for reproducible external evaluation. It is not part of the npm package, ordinary CI, `release-audit`, or `prepublishOnly`.

## Semantic tracks

The **governed-production** track sends eligible user turns through normal capture, verification, curation, patch, scope, and retrieval behavior. Assistant and tool observations remain bounded session evidence and are not silently promoted.

The **diagnostic-substrate** track converts sanitized trajectory units into low-confidence L2 records through an explicit benchmark patch. It measures storage and retrieval separately from capture. A diagnostic-substrate result is never labelled as a production score.

Every case and track receives a fresh root. The harness resolves that root and rejects overlap in either direction with the live PI store. Private sessions and existing user memories are not benchmark inputs.

## Commands

```console
bun run benchmark:prepare -- --benchmark ama-bench --preset contract --track both
bun run benchmark:approve -- --manifest <path> --fingerprint <exact-sha256>
bun run benchmark:run -- --manifest <path>
bun run benchmark:resume -- --run <run-directory>
bun run benchmark:verify -- --run <run-directory>
bun run benchmark:report -- --run <run-directory>
```

Approval requires the exact 64-character fingerprint. Prefixes and implicit latest manifests are rejected. Code, source revision, dataset revision or hashes, case IDs, model identities, prompts, limits, curation, seeds, and retries all affect the fingerprint.

`prepare` reports expected model calls and estimated cost. A paid run with an unknown cost remains blocked. Contract runs use a fake local reader and judge and make no network calls. Smoke, pilot, and full runs require separate manifests and approvals; one approval never authorizes another preset.

## Benchmark status

### AMA-Bench

The adapter is pinned to the official repository and public dataset. Smoke selection uses fixed software-engineering episode IDs, not random sampling. Evaluator-only QA answers and judge fields are removed before PI input. Official reader and judge model identities remain in the manifest and output validation.

### LongMemEval-V2

The adapter is pinned to the official source and Small dataset inputs. Web and enterprise question IDs are fixed. `answer`, `eval_function`, gold trajectory IDs, and evaluator-only fields do not enter PI ingestion or retrieval. Complete sanitized trajectories are passed through the official `Memory` interface.

### MemoryArena

An official executable repository became public after the initial design review. The compatibility probe now verifies its pinned source, runner, environment instructions, scoring implementation, dataset binding, model configuration, and memory interface. A protocol-faithful PI memory-service adapter is not implemented yet, so non-contract preparation fails with `pi_adapter_unavailable`. The harness does not reconstruct or describe a local score as official.

## Artifacts and reporting

Local manifests, approvals, raw runs, requests, traces, and case roots live under `reports/benchmarks/` and remain untracked. Validated public exports may be placed explicitly under `reports/benchmarks/public/`.

A public report preserves benchmark and dataset revisions, PI commit, track, curation policy, model identities, prompt and context limits, seeds, retries, failures, latency, context size, storage, cost, and official metrics. It removes credentials, private paths, temporary paths, and provider request identifiers. No cross-benchmark composite is calculated.

## Limitations

- Contract results test the harness, not benchmark quality.
- Diagnostic-substrate results bypass capture and are not production scores.
- A smoke result is not a pilot or full result.
- External benchmark performance does not prove complete production quality.
- Official runs remain unavailable when datasets, model configuration, cost assumptions, or protocol integration cannot be verified exactly.
