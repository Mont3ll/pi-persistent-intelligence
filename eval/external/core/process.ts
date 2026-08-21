export interface ProcessOptions { cwd?: string; env?: Record<string, string>; input?: string; timeoutMs?: number; maxOutputBytes?: number }
export interface ProcessResult { code: number; stdout: string; stderr: string }

export async function runProcess(command: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
  if (!command.length) throw new Error("process command cannot be empty");
  const max = options.maxOutputBytes ?? 8 * 1024 * 1024;
  const processHandle = Bun.spawn(command, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdin: options.input === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
  if (options.input !== undefined) {
    const stdin = processHandle.stdin;
    if (!stdin) throw new Error("process stdin is unavailable");
    stdin.write(options.input); stdin.end();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { processHandle.kill(); reject(new Error(`process timed out after ${options.timeoutMs ?? 30_000}ms`)); }, options.timeoutMs ?? 30_000); });
  try {
    const [code, stdout, stderr] = await Promise.race([
      Promise.all([processHandle.exited, new Response(processHandle.stdout).text(), new Response(processHandle.stderr).text()]), timeout,
    ]);
    if (Buffer.byteLength(stdout) > max || Buffer.byteLength(stderr) > max) throw new Error("process output exceeded bounded capture limit");
    return { code, stdout, stderr };
  } finally { if (timer) clearTimeout(timer); }
}
