# PI Governance Conformance Fixtures

This directory is a mirrored semantic contract shared by pi-persistent-intelligence and pi-governance-rs. Both repositories must retain byte-identical copies of every file.

`contract.json` pins the SHA-256 of each semantic fixture and records expectations used by both implementations. Contract changes require coordinated review and commits in both repositories. Runtime-specific producer versions and export timestamps are not compared.

The fixtures contain synthetic data only and must never be generated from a live PI store.
