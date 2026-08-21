#!/usr/bin/env python3
"""Compatibility gate for MemoryArena. No unofficial protocol is reconstructed."""
from __future__ import annotations
import argparse, json, pathlib, sys

REQUIRED = {
    "officialRepository": "README.md",
    "runnerEntrypoint": "run_math.py",
    "environmentSpecification": "env/README.md",
    "scoringImplementation": "env/env_systems/math_env.py",
    "datasetBinding": "run_math.py",
    "modelConfiguration": "configs/formal_reasoning_configs/math_longcontext_gpt-5-mini.json",
    "memoryInterface": "memory/client.py",
}
def probe(source_root: str, commit: str | None):
    if not commit or len(commit) != 40 or any(ch not in "0123456789abcdef" for ch in commit):
        return {"status":"source_unpinned","checks":{}}
    root=pathlib.Path(source_root); checks={name:(root/path).exists() for name,path in REQUIRED.items()}
    if not all(checks.values()): return {"status":"official_harness_unavailable","checks":checks,"sourceCommit":commit}
    checks["piAdapter"]=False
    return {"status":"pi_adapter_unavailable","checks":checks,"sourceCommit":commit}
def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--probe",action="store_true"); parser.add_argument("--run",action="store_true"); parser.add_argument("--source-root",default=".benchmark-cache/memoryarena"); parser.add_argument("--commit"); parser.add_argument("--output"); args=parser.parse_args()
    result=probe(args.source_root,args.commit)
    if args.probe: print(json.dumps(result,sort_keys=True)); return
    if args.run:
        print(json.dumps({"code":"pi_adapter_unavailable","message":"The official MemoryArena harness is public, but a protocol-faithful PI memory-service adapter is not implemented. No run was started."}),file=sys.stderr); raise SystemExit(2)
    parser.error("one of --probe or --run is required")
if __name__=="__main__": main()
