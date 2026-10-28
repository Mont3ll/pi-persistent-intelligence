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

**R0b release gate:** The opt-in source-aware policy is a guarded eligibility contract. The shipped capture path records observed host session identities but does **not** itself mark source transcripts verified. A source is eligible only after a separate trusted transcript-verification procedure sets `source_transcript_verified: true` on supporting evidence with matching session, turn, original-message SHA-256, trust and scope. Do not enable the opt-in policy on a live store until that procedure and its operational acceptance are verified. Historical and one-source ambiguous candidates do not automatically gain user authority. Stale auto proposals revalidate the configured floor and the source proof at application.

**R0c proof validation (not yet wired into automatic promotion):** `verifyCandidateTranscriptSource()` reads trusted Pi live/archived session JSONL and checks an exact session ID, one unique user-authored full-message SHA-256, the captured 300-character excerpt, matching internal evidence identity, and project identity inferred from the original session header. It does not trust a pre-existing `source_transcript_verified` field and does not write to the store. Ambiguous or unavailable transcripts fail closed. Candidate-provided file paths are never used. The R0c read-only verifier is **not** the final source-aware auto-apply integration: existing default policy must remain OFF until a trusted proof-attestation and apply-time revalidation path passes real-session acceptance.


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
