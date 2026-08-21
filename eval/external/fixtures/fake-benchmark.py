#!/usr/bin/env python3
import argparse, json, shlex, subprocess, tempfile

parser = argparse.ArgumentParser()
parser.add_argument("--worker", required=True)
args = parser.parse_args()
root = tempfile.mkdtemp(prefix="pi-fake-benchmark-")
proc = subprocess.Popen(shlex.split(args.worker), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
requests = [
    {"id":"1","op":"open","root":root,"track":"diagnostic","config":{"maxRecords":3,"maxChars":1000}},
    {"id":"2","op":"insert","caseId":"synthetic-1","items":[{"id":"turn-1","role":"user","content":"Prefer Bun for tests","at":"2026-08-01T00:00:00Z"}]},
    {"id":"3","op":"query","caseId":"synthetic-1","query":{"text":"Which test runner?"}},
    {"id":"4","op":"close","caseId":"synthetic-1"},
]
assert proc.stdin and proc.stdout
for request in requests:
    proc.stdin.write(json.dumps(request) + "\n")
proc.stdin.close()
responses = [json.loads(proc.stdout.readline()) for _ in requests]
code = proc.wait(timeout=10)
if code != 0 or not all(response.get("ok") for response in responses):
    raise SystemExit(1)
print(responses[2]["result"]["context"])
