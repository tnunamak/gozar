// Find the LocalAPI of the Tailscale macOS apps: a loopback TCP port plus a token.
//
// The Mac App Store app and the standalone ("macsys") app run tailscaled inside the app and expose no
// unix socket. Tailscale's own CLI finds them the way this module does. Upstream, at tailscale commit
// 1d32249f40ce9940c8ab5be63840756bf2cb6f68 (main on 2026-11-12; release v1.104.7 is the latest tag):
//
//   safesocket/safesocket_darwin.go
//     localTCPPortAndTokenDarwin   a non-GUI binary (cmd/tailscale) calls portAndTokenFromSameUserProof
//     portAndTokenFromSameUserProof  tries readMacosSameUserProof (App Store), then readMacsysSameUserProof
//                                  (standalone). Both missing: ErrTokenNotFound, and the CLI uses the unix socket.
//     readMacosSameUserProof       runs `lsof -n -a -u<uid> -c IPNExtension -F` and takes the first line that
//                                  holds ".tailscale.ipn.macos/sameuserproof-"; the rest of the line is
//                                  "<port>-<token>" (strings.SplitN(after, "-", 2)). A port that is not a number
//                                  is an error, which sends the caller to the next variant.
//     readMacsysSameUserProof      /Library/Tailscale/ipnport is a symlink whose target is the port number;
//                                  /Library/Tailscale/sameuserproof-<port> holds the token (TrimSpace, not empty);
//                                  a 1 second TCP dial to 127.0.0.1:<port> must succeed, because the files can be stale.
//     initSameUserProofToken       writes both formats: the App Store app leaves a file named
//                                  sameuserproof-<port>-<token> open (so lsof can find it); the standalone app
//                                  writes the token into sameuserproof-<port> and symlinks ipnport.
//   client/local/local.go
//     defaultDialer                dials 127.0.0.1:<port> (not "localhost", tailscale issue 7851)
//     DoLocalRequest               req.SetBasicAuth("", token): an empty user name, the token as password
//   ipn/localapi/localapi.go
//     Handler.ServeHTTP            Host must be "local-tailscaled.sock"; no basic auth is 401, a wrong
//                                  password is 403 (subtle.ConstantTimeCompare)
//
// Upstream tries the App Store variant before the standalone one; so does this module. A Mac cannot run
// both apps at once.
//
// The token is a secret. This module returns it to its one caller, which puts it in one request header and
// drops it. Nothing here logs it, throws it, stores it or caches it. Every failure is `null`.
import { execFile } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import net from 'node:net';
import { join } from 'node:path';

export const sharedDirectory = '/Library/Tailscale';
// lsof ships with macOS in /usr/sbin. An absolute path means a planted `lsof` on PATH cannot choose the port we send a token to.
const lsofProgram = '/usr/sbin/lsof';
const lsofTimeoutMs = 5000;
const lsofOutputLimit = 4 * 1024 * 1024;
const dialTimeoutMs = 1000;
const appStoreMarker = '.tailscale.ipn.macos/sameuserproof-';

const portOf = text => (/^[0-9]{1,5}$/.test(text) && Number(text) >= 1 && Number(text) <= 65535 ? Number(text) : null);
// A token goes into an HTTP Basic credential. Refuse anything that is not one printable token.
const tokenOf = text => (typeof text === 'string' && /^[\x21-\x7e]{1,256}$/.test(text) ? text : null);

/** Default effects. Tests replace each one; nothing else in this module touches the machine. */
export const realEffects = {
  platform: () => process.platform,
  uid: () => process.getuid?.() ?? null,
  readlink: path => readlink(path),
  readFile: path => readFile(path, 'utf8'),
  // Resolves the lsof standard output, rejects on any failure.
  runLsof: args => new Promise((resolve, reject) => {
    execFile(lsofProgram, args, { timeout: lsofTimeoutMs, maxBuffer: lsofOutputLimit, windowsHide: true, env: { LC_ALL: 'C' } },
      (error, stdout) => (error ? reject(new Error('lsof failed')) : resolve(String(stdout))));
  }),
  // Resolves true when something accepts a TCP connection on 127.0.0.1:<port> within one second.
  portOpen: port => new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = open => { socket.destroy(); resolve(open); };
    socket.setTimeout(dialTimeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  }),
};

/** App Store variant: the `lsof -F` field output of the IPNExtension process, as upstream parses it. */
export function parseLsofSameUserProof(output) {
  for (const line of String(output).split('\n')) {
    const at = line.indexOf(appStoreMarker);
    if (at < 0) continue;
    const fields = line.slice(at + appStoreMarker.length).split('-');
    if (fields.length < 2) continue;
    // Upstream splits on the first dash only: the token is everything after it.
    const port = portOf(fields[0]);
    // An unusable port ends this variant, as in upstream, where it returns an error to the caller.
    return port === null ? null : { port, token: tokenOf(fields.slice(1).join('-')) };
  }
  return null;
}

async function appStore(effects) {
  const uid = effects.uid();
  if (!Number.isInteger(uid)) return null;
  let output;
  try { output = await effects.runLsof(['-n', '-a', `-u${uid}`, '-c', 'IPNExtension', '-F']); } catch { return null; }
  const found = parseLsofSameUserProof(output);
  return found?.token ? { ...found, variant: 'app-store' } : null;
}

async function standalone(effects, directory) {
  try {
    const portText = String(await effects.readlink(join(directory, 'ipnport')));
    const port = portOf(portText);
    if (port === null) return null;
    const token = tokenOf(String(await effects.readFile(join(directory, `sameuserproof-${portText}`))).trim());
    if (token === null) return null;
    // The files can outlive the app: only a port that accepts a connection counts.
    return (await effects.portOpen(port)) ? { port, token, variant: 'standalone' } : null;
  } catch { return null; }
}

/**
 * The loopback port, token and variant (`app-store` or `standalone`) of a running Tailscale macOS app, or null. Never throws. On any platform
 * other than darwin it returns null before it reads a file or starts a program.
 */
export async function discoverAppLocalApi(overrides = {}) {
  const effects = { ...realEffects, ...overrides };
  if (effects.platform() !== 'darwin') return null;
  return (await appStore(effects)) ?? (await standalone(effects, overrides.sharedDirectory ?? sharedDirectory));
}
