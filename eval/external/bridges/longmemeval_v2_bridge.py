#!/usr/bin/env python3
"""LongMemEval-V2 Memory backend registered without modifying upstream files."""
from __future__ import annotations
import argparse, json, os, pathlib, shlex, subprocess, sys, tempfile

SOURCE_ROOT = pathlib.Path(os.environ.get("LONGMEMEVAL_SOURCE_ROOT", ".benchmark-cache/longmemeval-v2")).resolve()
if SOURCE_ROOT.exists(): sys.path.insert(0, str(SOURCE_ROOT))
try:
    from memory_modules.memory import Memory, register_memory
except ImportError:
    class Memory:
        def __init__(self, memory_params): self.memory_params = memory_params
    def register_memory(cls): return cls

class PiBridgeClient:
    def __init__(self, params):
        self.root = tempfile.mkdtemp(prefix="pi-longmemeval-case-"); self.sequence = 0; self.case_id = "current"
        self.proc = subprocess.Popen(shlex.split(str(params.get("bridgeWorker", "bun eval/external/bridge-worker.ts"))), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self._request("open", root=self.root, track=params.get("track", "production"), config={"maxRecords": int(params.get("maxRecords", 12)), "maxChars": int(params.get("maxChars", 14000))})
    def _request(self, op, **payload):
        self.sequence += 1; assert self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(json.dumps({"id":str(self.sequence),"op":op,**payload}, separators=(",", ":")) + "\n"); self.proc.stdin.flush(); response=json.loads(self.proc.stdout.readline())
        if not response.get("ok"): raise RuntimeError(response.get("error",{}).get("message","PI bridge failed"))
        return response["result"]
    def insert(self, trajectory):
        identifier = str(trajectory.get("id") or trajectory.get("trajectory_id") or f"trajectory-{self.sequence}")
        content = json.dumps(trajectory, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        self._request("insert", caseId=self.case_id, items=[{"id":identifier,"role":"observation","content":content,"at":"2000-01-01T00:00:00Z"}])
    def query(self, query, query_image=None):
        payload={"text":query};
        if query_image: payload["image"]=query_image
        return self._request("query", caseId=self.case_id, query=payload)

@register_memory
class PiPersistentIntelligenceMemory(Memory):
    memory_type = "pi_persistent_intelligence"
    def __init__(self, memory_params):
        super().__init__(memory_params); self.client = PiBridgeClient(memory_params)
    def insert(self, trajectory): self.client.insert(trajectory)
    def query(self, query, query_image=None):
        context=self.client.query(query, query_image).get("context", "")
        return [{"type":"text","value":context}] if context.strip() else []

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--probe",action="store_true"); parser.add_argument("--source-root",default=str(SOURCE_ROOT)); parser.add_argument("--data-root"); parser.add_argument("--output"); parser.add_argument("--tier",default="small"); parser.add_argument("--domain",default="both"); parser.add_argument("--memory-type",default="pi_persistent_intelligence"); parser.add_argument("--question-ids"); parser.add_argument("--track",default="production"); parser.add_argument("--bridge-worker",default="bun eval/external/bridge-worker.ts"); args=parser.parse_args()
    if args.probe: print(json.dumps({"interface":"Memory","memoryType":PiPersistentIntelligenceMemory.memory_type,"ready":SOURCE_ROOT.exists()})); return
    source=pathlib.Path(args.source_root).resolve(); sys.path.insert(0,str(source))
    from evaluation import run_eval
    run_eval.METHODS.add("pi")
    original=run_eval.build_memory_config
    def build_memory_config(runtime_args, data_root):
        if runtime_args.method != "pi": return original(runtime_args,data_root)
        return {"memory_type":"pi_persistent_intelligence","memory_params":{"bridgeWorker":args.bridge_worker,"track":args.track.split(",")[0],"maxRecords":12,"maxChars":14000}}
    run_eval.build_memory_config=build_memory_config
    for domain in (["web","enterprise"] if args.domain=="both" else [args.domain]):
        sys.argv=["run_eval.py","--data-root",args.data_root,"--domain",domain,"--tier",args.tier,"--method","pi","--output-dir",str(pathlib.Path(args.output)/domain),"--question-ids",args.question_ids]
        run_eval.main()
if __name__=="__main__": main()
