import { spawn } from 'node:child_process';

export function command(program, args, { input, timeoutMs = 30_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'], env, shell: false });
    let stdout = '', stderr = '', settled = false;
    const finish = (error, code) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) { child.kill('SIGTERM'); const kill = setTimeout(() => child.kill('SIGKILL'), 500); kill.unref(); reject(error); }
      else resolve({ code, stdout, stderr });
    };
    const timer = setTimeout(() => finish(new Error(`${program} timed out`)), timeoutMs);
    for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', chunk => {
      if (name === 'stdout') stdout += chunk; else stderr += chunk;
      if (stdout.length + stderr.length > 1_048_576) finish(new Error(`${program} output limit exceeded`));
    });
    child.stdin.on('error', () => {}); child.stdin.end(input);
    child.once('error', error => finish(error)); child.once('close', code => finish(null, code));
  });
}
