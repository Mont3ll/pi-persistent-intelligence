# Evidence, Trust, and Verification

PI treats memory candidates as claims that need to be evaluated before becoming durable beliefs. This evaluation happens through a structured evidence record and a deterministic verifier.

---

## Evidence records

Every candidate entering the inbox is backed by at least one evidence record stored in `memory/evidence.jsonl`. Evidence records carry:

- `trust_class`: the authority of the source
- `durability_signal`: how long this evidence justifies the claim
- `polarity`: whether the evidence supports, contradicts, or qualifies the claim
- `source_summary`: a short description of what the evidence says
- `source_excerpt`: a bounded excerpt (max 1000 characters) from the source
- `redaction_status`: `none`, `redacted`, or `deleted`

Evidence IDs are content-addressed: the same source excerpt from the same profile and session always produces the same ID. This prevents duplicate evidence from accumulating.

---

## Trust classes

Trust class determines how authoritative the source is and whether the candidate can auto-apply.

| Trust class | Weight | Can auto-apply? |
|---|---:|---|
| `direct_user_instruction` | 1.0 | Yes, if durable and verified |
| `user_correction` | 1.0 | Yes, if durable and verified |
| `repeated_user_preference` | 0.9 | Yes, with corroboration |
| `accepted_code_review_outcome` | 0.8 | Review preferred |
| `existing_project_convention` | 0.65 | Review preferred |
| `passing_tool_or_test_outcome` | 0.55 | Review only |
| `agent_inference` | 0.35 | Review only |
| `single_session_observation` | 0.3 | Review only |
| `repository_text` | 0.25 | Review only |
| `generated_content` | 0.2 | Review only |
| `third_party_documentation` | 0.2 | Never auto-applies |

`repository_text`, `generated_content`, and `third_party_documentation` are marked as high poisoning risk and cannot auto-apply under any governance mode. They always require human review.

---

## Durability signals

Durability signals indicate how long the claim is expected to remain valid.

| Signal | Meaning |
|---|---|
| `temporary` | Short-lived; cannot auto-promote to durable L2 |
| `task` | Relevant only to a specific task |
| `session` | Relevant only to the current session |
| `project` | Relevant for the lifetime of this project |
| `repository` | Relevant at the repository level |
| `user_global` | User-wide preference across all projects |
| `long_term` | Intended as a long-term durable belief |
| `unknown` | Not classified; routes to review |

Candidates with `temporary`, `task`, or `session` durability cannot auto-promote to durable L2 memory without explicit human conversion.

---

## Promotion eligibility

A candidate's promotion eligibility is derived from its trust class, durability signal, and proposed layer.

| Eligibility | Meaning |
|---|---|
| `auto_candidate` | Meets trust and durability thresholds; eligible for auto-apply in eligible governance mode |
| `review_only` | Must go through human review |
| `never` | Never promotes |
| `l1_review_only` | L1 proposal; always requires explicit ratification |

---

## Poisoning risk

Poisoning risk is inferred from the trust class and durability:

| Poisoning risk | Triggers |
|---|---|
| `high` | `repository_text`, `generated_content`, `third_party_documentation` |
| `medium` | `agent_inference`, `single_session_observation`; or non-durable durability |
| `low` | High-trust sources with durable signals |

High poisoning risk candidates are never auto-applied and are never default-selected in the patch review.

---

## The deterministic verifier

Before a candidate enters the patch pipeline, the verifier runs a series of deterministic checks:

1. **Source support**: does the evidence actually back the claim? Token overlap between the candidate statement and evidence summaries must meet a threshold.

2. **Trust boundary**: is the trust class eligible for the proposed scope and layer?

3. **Durability support**: is the durability signal compatible with durable L2 promotion?

4. **Poisoning risk**: is the evidence from a low-trust or generated source?

5. **Conflict check**: does this candidate have a match kind that requires review? (`potential_conflict`, `supersedes_existing`, `ambiguous`)

6. **Redacted or deleted evidence**: is any linked evidence record redacted or deleted? If so, it cannot support durable promotion.

7. **Tombstone check**: does this candidate target a memory ID that has been tombstoned? If so, it is rejected.

Verification outcomes:

| Status | Meaning |
|---|---|
| `legacy_unverified` | No trust metadata; compatibility mode treats as auto-eligible |
| `verified` | All checks pass; eligible for auto-apply depending on governance mode |
| `review_required` | One or more checks flag the candidate; must go through human review |
| `rejected` | Candidate is blocked from promotion (tombstone re-creation, redacted evidence, etc.) |

---

## Candidate matching

Before verification, each candidate is matched against existing active records using normalized memory keys. Match kinds:

| Match kind | Meaning | Auto-apply? |
|---|---|---|
| `new` | No existing record with this key | Yes, if verification passes |
| `duplicate` | Nearly identical statement; same key | Yes, if verification passes |
| `strengthens_existing` | Similar statement; same key | Yes, if verification passes |
| `updates_existing` | Update cue; same key | Yes, if verification passes |
| `potential_conflict` | Contradiction cue; same key | No; routes to review |
| `supersedes_existing` | Explicit supersession; same key | No; routes to review |
| `ambiguous` | Multiple active records share the key | No; routes to review |

Conflict, supersession, and ambiguous matches create open inquiry records to track the unresolved question.
