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
    "enabled": true
  },
  "curator": {
    "minConfidence": 0.75,
    "minEvidenceCount": 2,
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

### `curator`

| Key | Default | Description |
|---|---|---|
| `minConfidence` | `0.75` | Minimum confidence for a candidate to be eligible for curation |
| `minEvidenceCount` | `2` | Minimum evidence references required at apply time (1 for inbox display) |
| `autoCurate` | `"high-only"` | Auto-curation mode: `"off"`, `"high-only"`, or `"all-eligible"` |
| `autoCurateHighThreshold` | `0.85` | Confidence floor for `"high-only"` auto-apply |
| `inboxPromptThreshold` | `3` | Minimum pending candidates before inbox overlay appears (`0` to always show; `999` to disable) |

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

### `metaConsolidation`

| Key | Default | Description |
|---|---|---|
| `enabled` | `false` | Does not gate the `/meta-consolidation` command; reserved for future automation |
| `cadence` | `"manual"` | `"manual"`, `"weekly"`, or `"monthly"` (future use) |
| `min_l2_records` | `2` | Minimum cluster size to propose an L1 candidate |
| `min_reinforcement_score` | `0` | Minimum reinforcement score for a cluster to be eligible |
| `max_candidates_per_run` | `5` | Maximum L1 proposals per run |
| `max_input_records` | `50` | Maximum L2 records to process per run |
| `require_counterexample_search` | `true` | Whether counterexample search is mandatory (should not be disabled) |

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
| `PI_MEMORY_CONSOLIDATION_MODEL` | `claude-haiku-4-5-20251001` | LLM model for session-end consolidation |
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
