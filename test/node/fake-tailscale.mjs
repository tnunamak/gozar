// A fake `tailscale` CLI for session tests: it answers `status`, `serve status --json` and the foreground `funnel`
// watcher from one state file, so the real core and the real effect driver run the Funnel recipe against it.
//
//   - `funnel` registers a Foreground entry for its port and stays alive. A port that is visible already is refused.
//   - On SIGTERM the watcher records when it exited and leaves. The entry stays visible for `lingerMs` after that,
//     which is how a tailscaled that tears a foreground session down late looks to `serve status`.
//   - With `failServeStatus` set in the state, `serve status` fails, as a tailscaled that stops answering does.
//   - Every call is appended to the state's `calls`, so a test can prove which ports were ever asked for.
//
// Nothing here talks to a network, a real tailscaled or a credential file.
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const dnsName = 'device.example-tailnet.ts.net';
export const statusDocument = {
  BackendState: 'Running', Self: { ID: 'fixture-node', DNSName: `${dnsName}.`,
    CapMap: { funnel: null, https: null, 'https://tailscale.com/cap/funnel-ports?ports=443,8443,10000': null } },
  CurrentTailnet: { MagicDNSSuffix: 'example-tailnet.ts.net', MagicDNSEnabled: true }, CertDomains: [dnsName] };

const script = statePath => `#!${process.execPath}
const { readFileSync, writeFileSync } = require('node:fs');
const statePath = ${JSON.stringify(statePath)};
const load = () => JSON.parse(readFileSync(statePath, 'utf8'));
const save = state => writeFileSync(statePath, JSON.stringify(state));
const args = process.argv.slice(2);
const record = state => { (state.calls ??= []).push(args); save(state); };
const visible = (state, entry) => entry.exitedAt === undefined || Date.now() < entry.exitedAt + (state.lingerMs ?? 0);
const config = state => {
  const next = structuredClone(state.config);
  const foreground = Object.fromEntries(Object.entries(state.foreground ?? {}).filter(([, entry]) => visible(state, entry)).map(([id, entry]) => [id, entry.config]));
  if (Object.keys(foreground).length) next.Foreground = foreground;
  return next;
};
const portsOf = value => Object.keys(value?.TCP ?? {}).map(Number);
const takenPort = (state, port) => portsOf(state.config).includes(port) || Object.values(config(state).Foreground ?? {}).some(session => portsOf(session).includes(port));
const state = load();
if (args[0] === 'status') { record(state); console.log(JSON.stringify(state.status)); process.exit(0); }
if (args[0] === 'serve' && args[1] === 'status') { record(state); if (state.failServeStatus) { console.error('error: tailscaled is not responding'); process.exit(1); } console.log(JSON.stringify(config(state))); process.exit(0); }
if (args[0] === 'funnel') {
  const port = Number(args.find(arg => arg.startsWith('--https='))?.slice(8)), target = args.at(-1), host = state.status.Self.DNSName.replace(/\\.$/, '');
  record(state);
  if (state.refuseFunnel || takenPort(state, port)) { console.error('error: listener already exists for port ' + port); process.exit(1); }
  const id = 'session-' + process.pid;
  const fresh = load();
  (fresh.foreground ??= {})[id] = { config: { TCP: { [port]: { HTTPS: true } }, Web: { [host + ':' + port]: { Handlers: { '/': { Proxy: target } } } }, AllowFunnel: { [host + ':' + port]: true } } };
  save(fresh);
  process.on('SIGTERM', () => { const current = load(); current.foreground[id].exitedAt = Date.now(); save(current); process.exit(0); });
  console.log('Available on the internet:\\n\\nhttps://' + host + (port === 443 ? '' : ':' + port) + '/\\n|-- proxy ' + target + '\\n\\nPress Ctrl+C to exit.');
  setInterval(() => {}, 1000);
} else { record(state); console.error('unsupported fake tailscale call: ' + args.join(' ')); process.exit(2); }
`;

/**
 * Writes the fake into `directory/bin` and its state next to it. `config` is the persistent serve config
 * (TCP, Web, AllowFunnel) every session sees. Returns the PATH entry plus helpers to read and edit the state.
 */
export async function installFakeTailscale(directory, { config = {}, lingerMs = 0, refuseFunnel = false } = {}) {
  const bin = join(directory, 'bin'), statePath = join(directory, 'tailscale-state.json');
  await mkdir(bin, { recursive: true });
  const state = { status: statusDocument, config: { TCP: {}, Web: {}, AllowFunnel: {}, ...config }, foreground: {}, lingerMs, refuseFunnel, calls: [] };
  await writeFile(statePath, JSON.stringify(state));
  await writeFile(join(bin, 'tailscale'), script(statePath));
  await chmod(join(bin, 'tailscale'), 0o755);
  const read = async () => JSON.parse(await readFile(statePath, 'utf8'));
  return { bin, read, update: async edit => { const current = await read(); edit(current); await writeFile(statePath, JSON.stringify(current)); },
    /** The ports `funnel` was ever asked to serve. */
    funnelPorts: async () => (await read()).calls.filter(call => call[0] === 'funnel').map(call => Number(call.find(arg => arg.startsWith('--https=')).slice(8))) };
}

/** A durable-style rule for `port`: what `serve --bg` leaves in the persistent config. */
export const persistentRule = (port, target = 'http://127.0.0.1:7000') => ({
  TCP: { [port]: { HTTPS: true } }, Web: { [`${dnsName}:${port}`]: { Handlers: { '/': { Proxy: target } } } }, AllowFunnel: { [`${dnsName}:${port}`]: true } });
