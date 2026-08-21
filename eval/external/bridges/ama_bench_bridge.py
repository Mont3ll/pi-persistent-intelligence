#!/usr/bin/env python3
"""Narrow AMA-Bench adapter for PI. It never edits the upstream checkout."""
from __future__ import annotations
import argparse, hashlib, json, os, pathlib, shlex, subprocess, sys, tempfile

SOURCE_ROOT = pathlib.Path(os.environ.get("AMA_BENCH_SOURCE_ROOT", ".benchmark-cache/ama-bench")).resolve()
if SOURCE_ROOT.exists():
    sys.path.insert(0, str(SOURCE_ROOT))
try:
    from src.method.base_method import BaseMethod
except ImportError:
    class BaseMethod:  # Allows syntax checks and --probe without an installed checkout.
        pass

class PiBridgeClient:
    def __init__(self, worker: str, track: str):
        self.root = tempfile.mkdtemp(prefix="pi-ama-case-")
        self.proc = subprocess.Popen(shlex.split(worker), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.sequence = 0
        self._request("open", root=self.root, track=track, config={"maxRecords": 12, "maxChars": 14000})
    def _request(self, op: str, **payload):
        self.sequence += 1
        request = {"id": str(self.sequence), "op": op, **payload}
        assert self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(json.dumps(request, separators=(",", ":")) + "\n"); self.proc.stdin.flush()
        response = json.loads(self.proc.stdout.readline())
        if not response.get("ok"):
            raise RuntimeError(response.get("error", {}).get("message", "PI bridge request failed"))
        return response["result"]
    def insert_ama_trajectory(self, trajectory: str, task: str):
        case_id = hashlib.sha256((task + "\n" + trajectory).encode()).hexdigest()[:20]
        items = [
            {"id": "task", "role": "system", "content": task or "AMA-Bench task", "at": "2000-01-01T00:00:00Z"},
            {"id": "trajectory", "role": "observation", "content": trajectory, "at": "2000-01-01T00:00:01Z"},
        ]
        self._request("insert", caseId=case_id, items=items)
        return {"caseId": case_id}
    def query(self, case_id: str, question: str):
        return self._request("query", caseId=case_id, query={"text": question})

class PiMethod(BaseMethod):
    def __init__(self, config_path=None, **kwargs):
        config = json.load(open(config_path)) if config_path else {}
        self.client = PiBridgeClient(config.get("bridgeWorker", "bun eval/external/bridge-worker.ts"), config.get("track", "production"))
    def memory_construction(self, traj_text: str, task: str = ""):
        return self.client.insert_ama_trajectory(traj_text, task)
    def memory_retrieve(self, memory, question: str) -> str:
        return self.client.query(memory["caseId"], question).get("context", "")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--source-root", default=str(SOURCE_ROOT)); parser.add_argument("--dataset-file")
    parser.add_argument("--output"); parser.add_argument("--reader-config"); parser.add_argument("--judge-config")
    parser.add_argument("--episode-ids"); parser.add_argument("--track", default="production"); parser.add_argument("--bridge-worker", default="bun eval/external/bridge-worker.ts"); parser.add_argument("--pi-commit")
    args = parser.parse_args()
    if args.probe:
        print(json.dumps({"interface": "BaseMethod", "ready": SOURCE_ROOT.exists()})); return
    source = pathlib.Path(args.source_root).resolve(); sys.path.insert(0, str(source))
    from src import method_register
    method_register._METHOD_REGISTRY["pi"] = PiMethod
    method_register._LAZY_REGISTRY["pi"] = (__name__, "PiMethod")
    config_path = pathlib.Path(args.output) / "pi-method.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps({"bridgeWorker": args.bridge_worker, "track": args.track.split(",")[0]}))
    from src import run
    sys.argv = ["run.py", "--llm-config", args.reader_config, "--subset", "openend", "--method", "pi", "--method-config", str(config_path), "--test-file", args.dataset_file, "--judge-config", args.judge_config, "--episode-ids", args.episode_ids, "--output-dir", args.output]
    run.main()

if __name__ == "__main__":
    main()
