# Configuration

## Config file

Global config lives at:

```
~/.pi/agent/pi-memory/config.json
```

All settings are optional. Missing keys fall back to defaults.

---

## Full config with defaults

```json
{
  "qmd": {
    "collection": "pi-persistent-intelligence",
    "enabled": true,
    "injectionTimeoutMs": 800
  },
  "curator": {
    "minConfidence": 0.75,
    "minEvidenceCount": 2,
    "sourceAwareAuto": "off",
    "autoCurate": "high-only",
    "autoCurateHighThreshold": 0.85,
    "inboxPromptThreshold": 3
  },
  "maintainer": {
    "semiStableDecay": 0.15,
    "stableDecay": 0.05
  },
  "vault": {
    "enabled": false,
    "path": null,
    "reportOnly": true
  },
  "governance": {
    "mode": "compatibility"
  },
  "piGovernance": {
    "enabled": false,
    "mode": "external",
    "command": null,
    "store": null,
    "namespace": "default"
  },
  "retrieval": {
    "injectionMode": "scoped"
  },
  "inquiries": {
    "reviewWindowDays": 30
  },
  "reinforcement": {
    "neutralExposureEnabled": false
  },
  "metaConsolidation": {
    "enabled": false,
    "cadence": "manual",
    "min_l2_records": 2,
    "min_reinforcement_score": 0,
    "max_candidates_per_run": 5,
    "max_input_records": 50,
    "require_counterexample_search": true
  }
}
```

---

## Settings reference

### `qmd`

| Key | Default | Description |
|---|---|---|
| `collection` | `"pi-persistent-intelligence"` | qmd collection used for semantic memory retrieval |
| `enabled` | `true` | Enable semantic qmd retrieval during prompt injection |
| `injectionTimeoutMs` | `800` | Injection-only qmd timeout in milliseconds; integer from 100 to 5000. Invalid values fall back to 800. |

This timeout does not change explicit qmd search, setup, or update command budgets. Injection falls back to FTS when qmd fails or exceeds the budget.

### `curator`

| Key | Default | Description |
|---|---|---|
| `minConfidence` | `0.75` | Minimum confidence for a candidate to be eligible for curation |
| `minEvidenceCount` | `2` | Configured reference-count threshold for automatic curation; explicit manual review may propose a single source without auto-selecting it |
| `sourceAwareAuto` | `"off"` | Opt-in source-aware eligibility: `"off"` (default) or `"transcript-verified-direct-user"`. Allows one fully attributed, independently transcript-verified project-scoped direct-user turn to satisfy the automatic evidence requirement without reducing `minEvidenceCount`. All other governance gates remain in force. |
| `autoCurate` | `"high-only"` | Auto-curation mode: `"off"`, `"high-only"`, or `"all-eligible"` |
| `autoCurateHighThreshold` | `0.85` | Confidence floor for `"high-only"` auto-apply |
| `inboxPromptThreshold` | `3` | Minimum pending candidates before inbox overlay appears (`0` to always show; `999` to disable) |

**R0b/R0c/R0d source verification:** The capture path records observed host session IDs and original-message hashes, but does not trust a persisted `source_transcript_verified` marker. With `sourceAwareAuto: "transcript-verified-direct-user"`, curation now calls `verifyCandidateTranscriptSource()` against the original Pi session JSONL and validates exactly one user-authored full-message SHA-256, excerpt, scope, and evidence attribution. A missing or unflushed transcript is held and can be reconsidered on a later curation attempt. **Application runs the original-transcript verifier again within the governed transaction**; a stale proposal or manually modified verification flag cannot authorize a write.

The default remains `sourceAwareAuto: "off"`, with the configured two-reference automatic floor unchanged. No transcript or proof content is exported from R0d. The operation's existing patch rationale/receipt records the successful proof-based eligibility, without treating that receipt as future authority. No persistent attestation is created: fresh source-of-record verification is authoritative on both proposal and apply.

**R0e bounded discovery:** A curation invocation discovers trusted session headers once and reuses that in-memory index only as a path lookup hint; it is not persisted, exposed as memory evidence, or used to authorize application. Verification still reopens the original source and validates session identity, hash, user role, scope, and source excerpt. Apply discards any previously supplied index and performs fresh discovery and file-descriptor verification inside the governed transaction. An unflushed transcript remains held until a new curation attempt, which builds a fresh index. R0e also reuses a source-proof result within the same synchronous curation proposal, avoiding a duplicate source read; the governed apply transaction always recomputes its proof independently. Header discovery and full source inspection both use nonblocking/no-follow opens and reject opened objects that are not regular files (including a FIFO substituted after discovery). The full transcript read has a hard 32 MiB byte cap and compares descriptor metadata before/after, plus current pathname inode identity. The general sessions parser is not used to open untrusted transcript headers in this proof path. **Residual:** directory-component races, host-specific filesystem semantics, elapsed-time limits, and operation-level latency must be independently verified before live enablement. R0d still requires independent real Pi runtime verification, bounded discovery/performance review, and deployment acceptance before enabling the opt-in policy against a live store. Historical candidates with unresolved provenance are not automatically upgraded.

**R3a next-session retry (source-aware opt-in only):** If `curator.sourceAwareAuto` is `"transcript-verified-direct-user"` **and** `curator.autoCurate` is not `"off"`, the next primary Pi session start attempts a bounded (maximum 3 applied operations) retry of existing NEW, single-source candidates with observed-session attribution. This addresses the source transcript not yet being flushed at the previous session's shutdown. The original source is rediscovered and verified during curation and checked again during governed apply; no persisted verified boolean, prior proposal, or runtime message ID is treated as authority. On successful application the session's FTS and QMD indexes are updated. A missing, changed, assistant-authored or otherwise invalid source stays in governed review. Generated curator proposal IDs now include a digest of the proposed operations and mode, so distinct candidate sets curated in the same minute cannot inherit an earlier transaction receipt; identical proposals retain stable replay identity. The governed patch transaction also binds its durable receipt to the exact selected-operation subset and operation contents, so two selections of the same proposal cannot share a receipt; exact-request replays remain idempotent. A legacy receipt can be replayed only if its applied/skipped operation lists form a complete, unambiguous partition matching the saved proposal and requested selection; otherwise the transaction fails closed for manual reconciliation. Each canonical-changing governed transaction now writes an additional selection-specific receipt under `patches/receipts/`, preserving historical subsets even when the traditional `patches/<patch_id>.json` latest-view file is overwritten. Privacy-purge processing also snapshots completed governance transaction manifests into the guarded workspace, redacts correlated historical result payloads, and publishes those redactions through recoverable transaction execution before publishing canonical deletion. The original historical transaction metadata and replay identity remain, but redacted receipts cannot disclose purged content. A malformed or incomplete prior manifest blocks privacy purge for explicit reconciliation; interrupted transactions retain recovery workspaces until completion. This implementation must pass isolated privacy, crash-recovery and replay verification before release. Release-applicability detection also recognizes natural-language forms such as "releasing" and "released" so a release-scoped accepted memory can be recalled in the appropriate follow-up task. Child/agent subprocesses do not execute the retry. The retry does not change configuration, add candidates, mass-apply legacy history or run a background scheduler. With the default `sourceAwareAuto: "off"`, it performs no curation or transcript scans. It does not promise immediate same-session retry after an unflushed source appears; that remains a separate operational design decision. Live enablement and release acceptance remain gated.

### `maintainer`

| Key | Default | Description |
|---|---|---|
| `semiStableDecay` | `0.15` | Confidence reduction per overdue cycle for `semi-stable` records |
| `stableDecay` | `0.05` | Confidence reduction per overdue cycle for `stable` records |

### `governance`

| Key | Default | Description |
|---|---|---|
| `mode` | `"compatibility"` | `"compatibility"` or `"strict"` (see [Governance](governance.md)) |

### `piGovernance`

Optional external `pi-governance-rs` bridge diagnostics. Disabled standalone mode is valid and does not require Rust.

| Key | Default | Description |
|---|---|---|
| `enabled` | `false` | Enable optional diagnostics against an external Rust runtime |
| `mode` | `"external"` | External bridge mode; this package does not run an MCP server |
| `command` | `null` | Optional path to a `pi` Rust binary |
| `store` | `null` | Optional Rust store path |
| `namespace` | `"default"` | Namespace for compatibility checks |

### `retrieval`

| Key | Default | Description |
|---|---|---|
| `injectionMode` | `"scoped"` | `"scoped"`, `"policy_only"`, or `"wakeup"`. `policy_only` and `wakeup` avoid raw selected-memory injection. |

### `inquiries`

| Key | Default | Description |
|---|---|---|
| `reviewWindowDays` | `30` | Open inquiry age before it appears in `stale-scan`; integer from 1 to 3650 |

### `reinforcement`

| Key | Default | Description |
|---|---|---|
| `neutralExposureEnabled` | `false` | Record zero-weight neutral exposure, capped once per memory/session |

### `metaConsolidation`

| Key | Default | Description |
|---|---|---|
| `enabled` | `false` | Does not gate the `/meta-consolidation` command; reserved for future automation |
| `cadence` | `"manual"` | Reserved value: `"manual"`, `"weekly"`, or `"monthly"` |
| `min_l2_records` | `2` | Minimum cluster size to propose an L1 candidate |
| `min_reinforcement_score` | `0` | Minimum reinforcement score for a cluster to be eligible |
| `max_candidates_per_run` | `5` | Maximum L1 proposals per run |
| `max_input_records` | `50` | Maximum L2 records to process per run |
| `require_counterexample_search` | `true` | Whether counterexample search is mandatory (should not be disabled) |

No scheduler currently consumes `enabled` or `cadence`. Meta-consolidation runs only through the explicit report-only command; setting `weekly` or `monthly` does not schedule background or LLM work.

### `vault`

| Key | Default | Description |
|---|---|---|
| `enabled` | `false` | Whether vault integration is active |
| `path` | `null` | Path to your Obsidian vault directory |
| `reportOnly` | `true` | `true`: generate vault-promotion reports but do not mutate the vault; `false`: future use |

---

## Environment variables

Environment variables override config file values.

| Variable | Default | Description |
|---|---|---|
| `PI_MEMORY_ROOT` | `~/.pi/agent/pi-memory/` | Override the memory root directory |
| `PI_MEMORY_CONSOLIDATION_MODEL` | current Pi session model, then Pi CLI default | Optional preferred LLM model for session-end consolidation. If unset, PI uses the model observed in the active Pi session; if no model has been observed, the consolidation subprocess omits `--model` and lets the Pi CLI choose its configured default. |
| `PI_VAULT_PATH` | `config.vault.path` | Path to Obsidian vault; enables `vault_ref` auto-suggestions during curation |

---

## Project-local storage

To keep a project's memory isolated from the global store, add a settings file in the project:

```json
// {project}/.pi/settings.json
{
  "pi-persistent-intelligence": {
    "localPath": ".pi/pi-memory"
  }
}
```

When PI starts in a directory with this file, it uses the local path as the memory root. This creates separate L1, L2, inbox, patches, and daily logs for the project.

Project-local memory is fully isolated: records in one project do not appear in another.

---

## qmd settings

qmd provides optional semantic search over memory records and session summaries.

| Key | Default | Description |
|---|---|---|
| `qmd.collection` | `"pi-persistent-intelligence"` | qmd collection name for memory records |
| `qmd.enabled` | `true` | Whether qmd integration is active |

To set up qmd semantic search:

```bash
# Install qmd if not installed
npm install -g @tobilu/qmd

# Generate embeddings after sessions are indexed
qmd embed
```

Once embeddings are generated, `memory_search --mode=semantic` and `session_search --mode=semantic` use qmd.
