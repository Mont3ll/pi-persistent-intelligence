# Handoff Snapshots

A handoff snapshot is a structured summary of current active memory state. It is background reference material, not a memory mutation.

---

## What a handoff snapshot contains

- Active L1 and L2 record counts
- A brief summary of selected memory from the current context
- Open inquiry count and questions
- Contested record IDs
- Recent evidence record count
- Pending inbox candidate count

---

## Generating a handoff snapshot

```bash
/memory-handoff
```

Or combined with a meta-consolidation run:

```bash
/meta-consolidation --handoff
```

---

## Where snapshots are stored

Reports are written to `reports/handoff/`:

- `<timestamp>.md`: human-readable snapshot
- `<timestamp>.json`: machine-readable snapshot

These files are excluded from the npm package.

---

## What handoff snapshots are for

Handoff snapshots are useful when:

- You are switching context (e.g. handing off to a different session or agent)
- You want a quick summary of what the agent currently knows before starting a complex task
- You are troubleshooting and want to see what is in memory without reading raw JSONL

---

## Important: canonical memory remains authoritative

A handoff snapshot is a point-in-time summary. It is not a replacement for canonical memory. The JSONL files are always the source of truth.

The snapshot header includes this notice explicitly. When reviewing a snapshot, treat it as context. Do not act on the snapshot in isolation without checking current canonical memory if the information is time-sensitive or operationally important.
