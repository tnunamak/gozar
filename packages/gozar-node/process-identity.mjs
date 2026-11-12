import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';

// A process identity is a string that stays the same for one process lifetime and differs once the
// PID is reused. It is null for a missing or zombie process. It throws when the answer cannot be read:
// "could not look" must never be taken for "is dead".
//
// linux:  start ticks (field 22 of /proc/<pid>/stat). Stored identities stay valid, so this is unchanged.
// darwin: `ps -o lstart=,stat=`. macOS has no procfs, and every source that ships with it without native
//         code (ps lstart/start/etime) has one-second resolution. That still cannot repeat for a PID in
//         practice: reusing a PID needs the whole PID space (99999) to wrap inside one second.
//         TZ and LC_ALL are pinned so one process prints one string from any caller's environment.
// other:  null, as before.
const psTimeoutMs = 5000;
const psLine = /^([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}) +(\S+)$/;

function psStat(pid) {
  return new Promise((resolve, reject) => {
    execFile('/bin/ps', ['-o', 'lstart=,stat=', '-p', String(pid)],
      { env: { LC_ALL: 'C', TZ: 'UTC' }, timeout: psTimeoutMs, windowsHide: true, maxBuffer: 4096 }, (error, stdout) => {
        // ps exits 1 with no output for a PID that does not exist.
        if (error && error.code === 1 && !String(stdout).trim()) return resolve({ stdout: '' });
        if (error) return reject(new Error(`Cannot read process identity: ps failed (${error.killed ? 'timed out' : error.code ?? error.message})`));
        resolve({ stdout: String(stdout) });
      });
  });
}

async function linuxIdentity(pid, readProc) {
  try {
    // Start ticks disambiguate PID reuse, including command names with spaces/parentheses.
    const stat = await readProc(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[0] === 'Z') return null;
    return fields[19];
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error.code)) return null;
    throw error;
  }
}

async function darwinIdentity(pid, run) {
  const { stdout } = await run(pid);
  const text = stdout.trim();
  if (!text) return null;
  const match = psLine.exec(text);
  if (!match) throw new Error('Cannot read process identity: unrecognized ps output');
  if (match[2].startsWith('Z')) return null;
  return match[1].replace(/ +/g, ' ');
}

// deps is a test seam: { platform, readProc(path, encoding), run(pid) -> { stdout } }.
export async function processIdentity(pid, deps = {}) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  const platform = deps.platform ?? process.platform;
  if (platform === 'linux') return linuxIdentity(pid, deps.readProc ?? readFile);
  if (platform === 'darwin') return darwinIdentity(pid, deps.run ?? psStat);
  return null;
}

// A one-argument identity function bound to a fixed set of test seams.
export const identityWith = deps => pid => processIdentity(pid, deps);
